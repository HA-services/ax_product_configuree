/** @odoo-module */

import { _t } from "@web/core/l10n/translation";
import { registry } from '@web/core/registry';
import { x2ManyCommands } from "@web/core/orm_service";
import { useService } from "@web/core/utils/hooks";
import { patch } from "@web/core/utils/patch";
import { useRecordObserver } from "@web/model/relational_model/utils";
import {
    productLabelSectionAndNoteField,
    ProductLabelSectionAndNoteField
} from "@account/components/product_label_section_and_note_field/product_label_section_and_note_field";
import { OxProductConfigureDialog } from "./product_configurator_dialog/product_configurator_dialog";

// Patch the standard Many2oneField for product_id in stock.move
async function applyProduct(record, product) {
    // Ensure x2many fields are properly initialized before updating to prevent "Invalid ids list: false" errors
    // This fixes the issue where Odoo tries to unlink records and gets false instead of an array
    if (record.data.product_custom_attribute_value_ids) {
        const customAttrField = record.data.product_custom_attribute_value_ids;
        if (customAttrField.currentIds === false || customAttrField.currentIds === null || customAttrField.currentIds === undefined) {
            customAttrField.currentIds = [];
        }
    }
    if (record.data.product_template_attribute_value_ids) {
        const templateAttrField = record.data.product_template_attribute_value_ids;
        if (templateAttrField.currentIds === false || templateAttrField.currentIds === null || templateAttrField.currentIds === undefined) {
            templateAttrField.currentIds = [];
        }
    }
    if (record.data.product_no_variant_attribute_value_ids) {
        const noVariantField = record.data.product_no_variant_attribute_value_ids;
        if (noVariantField.currentIds === false || noVariantField.currentIds === null || noVariantField.currentIds === undefined) {
            noVariantField.currentIds = [];
        }
    }
    
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

    // Build update values - ensure all values are properly defined
    // Get product_template_id from the product object (from configurator)
    const productTemplateId = product.product_tmpl_id;
    
    // Ensure product.id is a valid integer
    const productId = parseInt(product.id);
    if (isNaN(productId)) {
        console.error('Product configurator: Invalid product.id', product.id);
        throw new Error('Product ID must be a valid integer');
    }
    
    // Build update - set product_id FIRST as it's required
    // Use _update() to avoid triggering onchange that might clear product_id
    const updateValues = {
        product_id: { 
            id: productId, 
            display_name: product.display_name || '' 
        },
    };
    
    // Set product_uom_qty if provided, otherwise use default
    const quantity = product.quantity !== undefined && product.quantity !== null ? product.quantity : 1.0;
    updateValues.product_uom_qty = quantity;
    
    // Set product_template_id - it's a regular Many2one field so we need to set it
    // Only set if the field exists in the record's model
    if (productTemplateId && productTemplateId !== false && productTemplateId !== null) {
        const templateId = parseInt(productTemplateId);
        if (!isNaN(templateId)) {
            // Check if record has product_template_id field
            const hasProductTemplateField = record.model?.fields?.product_template_id || 
                                          record.data.hasOwnProperty('product_template_id') ||
                                          record.fieldsInfo?.product_template_id;
            
            if (hasProductTemplateField) {
                // Get template display name - construct from product display name
                const displayName = product.display_name || '';
                let templateDisplayName = displayName;
                if (displayName && typeof displayName === 'string' && displayName.includes('(')) {
                    templateDisplayName = displayName.split('(')[0].trim();
                }
                
                updateValues.product_template_id = {
                    id: templateId,
                    display_name: templateDisplayName || displayName || ''
                };
            }
        }
    }
    
    // Prepare x2many fields - always set them if field exists, even if empty, to prevent unlink errors
    const validNoVariantIds = Array.isArray(noVariantPTAVIds) ? noVariantPTAVIds : [];
    const hasNoVariantField = record.model?.fields?.product_no_variant_attribute_value_ids ||
                             record.data.hasOwnProperty('product_no_variant_attribute_value_ids') ||
                             record.fieldsInfo?.product_no_variant_attribute_value_ids;
    
    // Always set the field if it exists, even if empty, to ensure proper initialization
    // This prevents "Invalid ids list: false" error when Odoo tries to unlink records
    if (hasNoVariantField) {
        updateValues.product_no_variant_attribute_value_ids = [x2ManyCommands.set(validNoVariantIds)];
    }
    
    // Only add custom attribute values if we have valid commands and field exists
    const validCustomCommands = Array.isArray(customAttributesCommands) && customAttributesCommands.length > 0 
        ? customAttributesCommands 
        : [x2ManyCommands.set([])];
    
    const hasCustomAttributeField = record.model?.fields?.product_custom_attribute_value_ids ||
                                   record.data.hasOwnProperty('product_custom_attribute_value_ids') ||
                                   record.fieldsInfo?.product_custom_attribute_value_ids;
    
    // Always set custom attribute values if field exists, even if empty, to ensure field is properly initialized
    if (hasCustomAttributeField) {
        updateValues.product_custom_attribute_value_ids = validCustomCommands;
    }
    
    // Update all fields at once using _update() to avoid triggering onchange
    // This ensures product_id is set before any onchange can clear it
    try {
        await record._update(updateValues);
    } catch (error) {
        console.error('Error updating stock move with product:', error);
        console.error('Update values:', updateValues);
        console.error('Record:', record);
        throw error;
    }
}

// Create custom field component for stock.move product_template_id
export class StockMoveProductField extends ProductLabelSectionAndNoteField {
    static template = "axsync_product_configure.StockMoveProductField";
    setup() {
        super.setup(...arguments);
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.currentValue = this.props.record.data[this.props.name];

        useRecordObserver((record) => {
            if (record.isInEdition && record.data[this.props.name]) {
                if (!this.currentValue || this.currentValue.id != record.data[this.props.name].id) {
                    // Field was updated if line was open in edit mode,
                    //      field is not emptied,
                    //      new value is different than existing value.
                    this._onProductTemplateUpdate();
                }
            }
            this.currentValue = record.data[this.props.name];
        });
    }

    get configurationButtonHelp() {
        return _t("Edit Configuration");
    }
    
    get isConfigurableTemplate() {
        return this.props.record.data.is_configurable_product || false;
    }

    // Override productName to handle undefined values and show variant if available
    get productName() {
        // If product_id (variant) is set, use its display_name which includes variant info (e.g., "charger (S)")
        const productId = this.props.record.data.product_id;
        if (productId) {
            // Handle different formats: {id, display_name} or [id, display_name]
            if (productId.display_name) {
                return productId.display_name;
            }
            // If it's an array format [id, name], use the name
            if (Array.isArray(productId) && productId.length > 1) {
                return productId[1];
            }
            // If it's just an ID, try to get display_name from the record
            if (productId.id || (Array.isArray(productId) && productId[0])) {
                // Try to get the display_name from the record's loaded data
                const productIdValue = productId.id || productId[0];
                // Check if we can get display_name from the record
                if (this.props.record.resModel === 'stock.move') {
                    // For stock.move, product_id should have display_name loaded
                    // If not, we'll fall back to template
                }
            }
        }
        // Fallback to product_template_id display_name
        const productTemplate = this.props.record.data[this.props.name];
        return productTemplate?.display_name || "";
    }

    // Override label to handle undefined values
    get label() {
        const descriptionColumn = this.descriptionColumn || 'name';
        let label = this.props.record.data[descriptionColumn] || "";
        const productName = this.productName;
        if (label && productName && typeof label === 'string' && label.includes(productName)) {
            label = label.replace(productName, "");
        }
        return label.trim();
    }

    // Override isProductClickable to handle missing evalContext in stock.move
    get isProductClickable() {
        try {
            // Stock.move doesn't have evalContext.parent like purchase/sale orders
            // Check if we're in a picking context or standalone
            const pickingRecord = this.props.record.model?.root;
            if (pickingRecord) {
                const state = pickingRecord.data.state;
                return state && state !== "draft";
            }
            // Fallback: allow clicking if record exists and is not draft
            const moveState = this.props.record.data.state;
            return moveState && moveState !== "draft";
        } catch {
            return false;
        }
    }

    // Override sectionAndNoteIsReadonly to handle missing evalContext in stock.move
    get sectionAndNoteIsReadonly() {
        // Stock.move doesn't have evalContext.parent, so handle it gracefully
        try {
            const pickingRecord = this.props.record.model?.root;
            if (pickingRecord) {
                const state = pickingRecord.data.state;
                return (
                    this.props.readonly
                    && this.isProductClickable
                    && state && ["cancel", "done"].includes(state)
                );
            }
            return this.props.readonly && this.isProductClickable;
        } catch {
            return this.props.readonly && this.isProductClickable;
        }
    }

    async _onProductTemplateUpdate() {
        // Check if product_template_id exists and is valid
        const productTemplate = this.props.record.data.product_template_id;
        if (!productTemplate) {
            return;
        }
        
        // Handle both data structures: .id (from standard) or [0] (from standard)
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
                        this._openProductConfigurator(productTemplateId);
                    }
                }
            }
        } catch (error) {
            console.warn("Error in stock.move product_template_id field _onProductTemplateUpdate:", error);
        }
    }

    onEditConfiguration() {
        if (this.props.record.data.is_configurable_product) {
            const productTemplate = this.props.record.data.product_template_id;
            if (productTemplate) {
                const productTemplateId = productTemplate.id || productTemplate[0];
                if (productTemplateId) {
                    this._openProductConfigurator(productTemplateId, true);
                }
            }
        }
    }

    async _openProductConfigurator(productTemplateId, isEdit = false) {
        const stockMoveRecord = this.props.record;
        const pickingRecord = stockMoveRecord.model.root;
        
        // Get currency and company from picking or company
        let currencyId = undefined;
        let companyId = undefined;
        
        if (pickingRecord && pickingRecord.data.company_id) {
            companyId = pickingRecord.data.company_id.id || pickingRecord.data.company_id[0];
            if (companyId) {
                const company = await this.orm.read('res.company', [companyId], ['currency_id']);
                if (company && company[0]) {
                    currencyId = company[0].currency_id[0];
                }
            }
        }
        
        // Default currency fallback
        if (!currencyId) {
            const companies = await this.orm.searchRead('res.company', [], ['currency_id'], { limit: 1 });
            if (companies && companies[0]) {
                currencyId = companies[0].currency_id[0];
            }
        }
        
        if (!currencyId) {
            console.error("Currency ID is required but not found");
            return;
        }
        
        // Get existing attribute values
        let ptavIds = [];
        if (stockMoveRecord.data.product_template_attribute_value_ids?.records) {
            ptavIds = stockMoveRecord.data.product_template_attribute_value_ids.records.map(
                record => record.resId
            );
        }
        
        let customAttributeValues = [];
        const isEditingRecord = isEdit || !!stockMoveRecord.resId;
        if (isEditingRecord && stockMoveRecord.data.product_custom_attribute_value_ids) {
            // Ensure the x2many field structure is valid before accessing it
            const customAttrField = stockMoveRecord.data.product_custom_attribute_value_ids;
            
            // If currentIds is false or invalid, initialize it to empty array to prevent unlink errors
            if (customAttrField.currentIds === false || customAttrField.currentIds === null || customAttrField.currentIds === undefined) {
                customAttrField.currentIds = [];
            }
            
            if (customAttrField.records) {
                customAttributeValues = customAttrField.records[0]?.isNew ?
                    customAttrField.records.map(
                        record => record.data
                    ) :
                    await this.orm.read(
                        'product.attribute.custom.value',
                        Array.isArray(customAttrField.currentIds) 
                            ? customAttrField.currentIds 
                            : [],
                        ["custom_product_template_attribute_value_id", "custom_value"]
                    );
            }
        }
        
        this.dialog.add(OxProductConfigureDialog, {
            productTemplateId: productTemplateId,
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
            quantity: stockMoveRecord.data.product_uom_qty || 1.0,
            productUOMId: stockMoveRecord.data.product_uom?.id || stockMoveRecord.data.product_uom?.[0],
            companyId: companyId,
            currencyId: currencyId,
            edit: isEditingRecord,
            save: async (mainProduct, optionalProducts) => {
                await applyProduct(stockMoveRecord, mainProduct);
                if (pickingRecord && pickingRecord.data.move_ids) {
                    pickingRecord.data.move_ids.leaveEditMode();
                }
                // Note: Optional products would need to be added as new moves
                // For now, we only handle the main product
            },
            discard: () => {
                // Match purchase order pattern - simple delete from move_ids if it exists
                // This is simpler and avoids the "Invalid ids list: false" error
                if (pickingRecord && pickingRecord.data.move_ids) {
                    // Delete from the picking's move_ids (similar to purchase order's order_line.delete)
                    pickingRecord.data.move_ids.delete(stockMoveRecord);
                } else if (!stockMoveRecord.resId) {
                    // If not in a picking context and it's a new record, delete it directly
                    stockMoveRecord.delete();
                }
                // For existing records not in a picking, just let the dialog close
                // Odoo will handle the revert automatically
            },
        });
    }
}

// Register the custom widget for stock.move product_template_id
registry.category("fields").add("sm_product_many2one", {
    ...productLabelSectionAndNoteField,
    component: StockMoveProductField,
});


