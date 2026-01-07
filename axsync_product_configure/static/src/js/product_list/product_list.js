/** @odoo-module */

import { Component } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { Product } from "../product/product";

export class PurchaseProductList extends Component {
    static components = { Product };
    static template = "oxProductConfigure.PurchaseProductList";
    static props = {
        products: Array,
        areProductsOptional: { type: Boolean, optional: true },
    };
    static defaultProps = {
        areProductsOptional: false,
    };

    get optionalProductsTitle() {
        return _t("Add optional products");
    }
}
