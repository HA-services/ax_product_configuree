/** @odoo-module */

import { Component } from "@odoo/owl";

export class QuantityButtons extends Component {
    static template = "axsync_product_configure.QuantityButtons";
    static props = {
        quantity: Number,
        setQuantity: Function,
        isMinusButtonDisabled: { type: Boolean, optional: true },
        isPlusButtonDisabled: { type: Boolean, optional: true },
        btnClasses: { type: String, optional: true },
    };

    decreaseQuantity() {
        this.props.setQuantity(this.props.quantity - 1);
    }

    increaseQuantity() {
        this.props.setQuantity(this.props.quantity + 1);
    }

    setQuantity(event) {
        const value = parseFloat(event.target.value);
        if (!isNaN(value) && value >= 0) {
            this.props.setQuantity(value);
        }
    }
}

