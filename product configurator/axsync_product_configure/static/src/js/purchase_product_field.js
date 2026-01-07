/** @odoo-module */

import { PurchaseOrderLineProductField } from '@purchase_product_matrix/js/purchase_product_field';
import { x2ManyCommands } from "@web/core/orm_service";
import { useService } from "@web/core/utils/hooks";
import { patch } from "@web/core/utils/patch";
import { OxProductConfigureDialog } from "./product_configurator_dialog/product_configurator_dialog";

async function applyProduct(record, product) {
    // handle custom values & no variants
    const customAttributesCommands = [
        x2ManyCommands.set([]),  // Command.clear isn't supported in static_list/_applyCommands
    ];
    for (const ptal of product.attribute_lines || []) {
        const selectedCustomPTAV = ptal.attribute_values?.find(
            ptav => ptav.is_custom && ptal.selected_attribute_value_ids?.includes(ptav.id)
        );
        if (selectedCustomPTAV && ptal.customValue !== undefined && ptal.customValue !== null) {
            customAttributesCommands.push(
                x2ManyCommands.create(undefined, {
                    custom_product_template_attribute_value_id: [selectedCustomPTAV.id, "we don't care"],
                    custom_value: ptal.customValue,
                })
            );
        }
    }
    const noVariantPTAVIds = (product.attribute_lines || [])
        .filter((ptal) => ptal.create_variant === "no_variant")
        .flatMap((ptal) => ptal.selected_attribute_value_ids || []);

    // We use `_update` (not locked) instead of `update` (locked) so that multiple records can be
    // updated in parallel (for performance), matching sale order implementation
    // Ensure product.id exists - it should be set by the configurator's onConfirm method
    if (!product.id || product.id === false) {
        console.error('Product configurator: product.id is missing or false', product);
        throw new Error('Product ID is required but not available. The product variant may need to be created.');
    }

    const update_values = {
        product_id: { 
            id: product.id, 
            display_name: product.display_name || '' 
        },
        product_qty: product.quantity || 1.0,
        product_no_variant_attribute_value_ids: [x2ManyCommands.set(noVariantPTAVIds || [])],
        product_custom_attribute_value_ids: customAttributesCommands,
    };
    
    await record._update(update_values);
};

patch(PurchaseOrderLineProductField.prototype, {
    setup() {
        super.setup(...arguments);
        this.dialog = useService("dialog");
        this.orm = useService("orm");
    },
    async _onProductTemplateUpdate() {
        // Check if product_template_id exists and is valid
        const productTemplate = this.props.record.data.product_template_id;
        if (!productTemplate) {
            return;
        }
        
        // Handle both data structures: .id (from purchase_product_matrix) or [0] (from standard)
        const productTemplateId = productTemplate.id || productTemplate[0];
        if (!productTemplateId) {
            return;
        }
        
        try {
            const result = await this.orm.call(
                'product.template',
                'get_single_product_variant',
                [productTemplateId],
            );
            
            if (result && result.product_id) {
                const currentProductId = this.props.record.data.product_id;
                const currentId = currentProductId?.id || currentProductId?.[0];
                
                if (currentId != result.product_id.id) {
                    this.props.record.update({
                        product_id: { id: result.product_id, display_name: result.product_name },
                    });
                }
            } else {
                // Product is configurable, check config mode
                const product_config_mode = await this.orm.read(
                    'product.template',
                    [productTemplateId],
                    ["product_config_mode"]
                );
                
                if (product_config_mode && product_config_mode[0]) {
                    const mode = product_config_mode[0].product_config_mode;
                    if (!mode || mode === 'configurator') {
                        this._openProductConfigurator();
                    } else {
                        // only triggered when purchase_product_matrix is installed.
                        if (super._openGridConfigurator) {
                            super._openGridConfigurator(false);
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("Error in _onProductTemplateUpdate:", error);
        }
    },

    /**
     * Checks if the template is configurable.
     */
    get isConfigurableTemplate() {
        return super.isConfigurableTemplate || this.props.record.data.is_configurable_product;
    },
    /**
     * Opens the product configurator.
     */
    async _openProductConfigurator(jsonInfo, productTemplateId, editedCellAttributes,edit=false) {
        // Check if product_template_id exists and is valid
        const productTemplate = this.props.record.data.product_template_id;
        if (!productTemplate) {
            console.warn("Cannot open product configurator: product_template_id is not set.");
            return;
        }
        
        // Handle both data structures: .id (from purchase_product_matrix) or [0] (from standard)
        const templateId = productTemplate.id || productTemplate[0];
        if (!templateId) {
            console.warn("Cannot open product configurator: product_template_id is invalid.");
            return;
        }
        
        const purchaseOrderRecord = this.props.record.model.root;
        
        // Get ptavIds - handle case where field might not exist
        let ptavIds = [];
        if (this.props.record.data.product_template_attribute_value_ids?.records) {
            ptavIds = this.props.record.data.product_template_attribute_value_ids.records.map(
                record => record.resId
            );
        }
        
        let customAttributeValues = [];
        if (edit) {
            /**
             * no_variant and custom attribute don't need to be given to the configurator for new
             * products.
             */
            if (this.props.record.data.product_no_variant_attribute_value_ids?.records) {
                ptavIds = ptavIds.concat(this.props.record.data.product_no_variant_attribute_value_ids.records.map(
                    record => record.resId
                ));
            }
            /**
             *  `product_custom_attribute_value_ids` records are not loaded in the view bc sub templates
             *  are not loaded in list views. Therefore, we fetch them from the server if the record is
             *  saved. Else we use the value stored on the line.
             */
            if (this.props.record.data.product_custom_attribute_value_ids?.records) {
                customAttributeValues =
                    this.props.record.data.product_custom_attribute_value_ids.records[0]?.isNew ?
                    this.props.record.data.product_custom_attribute_value_ids.records.map(
                        record => record.data
                    ) :
                    await this.orm.read(
                        'product.attribute.custom.value',
                        this.props.record.data.product_custom_attribute_value_ids.currentIds || [],
                        ["custom_product_template_attribute_value_id", "custom_value"]
                    );
            }
        }
        
        // Get currency_id with fallbacks
        let currencyId = undefined;
        if (this.props.record.data.currency_id) {
            currencyId = this.props.record.data.currency_id.id || this.props.record.data.currency_id[0];
        } else if (purchaseOrderRecord.data.currency_id) {
            currencyId = purchaseOrderRecord.data.currency_id.id || purchaseOrderRecord.data.currency_id[0];
        }
        
        if (!currencyId) {
            console.error("Currency ID is required but not found");
            return;
        }
        
        this.dialog.add(OxProductConfigureDialog, {
            productTemplateId: templateId,
            ptavIds: ptavIds,
            customAttributeValues: customAttributeValues.map(
                data => {
                    const ptavId = data.custom_product_template_attribute_value_id;
                    return {
                        ptavId: ptavId?.id || ptavId?.[0] || ptavId,
                        value: data.custom_value,
                    }
                }
            ),
            quantity: this.props.record.data.product_qty || 1.0,
            productUOMId: this.props.record.data.product_uom?.id || this.props.record.data.product_uom?.[0],
            companyId: purchaseOrderRecord.data.company_id?.id || purchaseOrderRecord.data.company_id?.[0],
            currencyId: currencyId,
            edit: edit,
            save: async (mainProduct, optionalProducts) => {
                await applyProduct(this.props.record, mainProduct);
                purchaseOrderRecord.data.order_line.leaveEditMode();
                for (const optionalProduct of optionalProducts) {
                    const line = await purchaseOrderRecord.data.order_line.addNewRecord({
                        position: 'bottom',
                        mode: "readonly",
                    });
                    await applyProduct(line, optionalProduct);
                }
            },
            discard: () => {
                purchaseOrderRecord.data.order_line.delete(this.props.record);
            },
        });
    },
});
