# -*- coding: utf-8 -*-
################################################################################
#
#    Cybrosys Technologies Pvt. Ltd.
#
#    Copyright (C) 2024-TODAY Cybrosys Technologies(<https://www.cybrosys.com>).
#    Author: Unnimaya C O (odoo@cybrosys.com)
#
#    You can modify it under the terms of the GNU AFFERO
#    GENERAL PUBLIC LICENSE (AGPL v3), Version 3.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU AFFERO GENERAL PUBLIC LICENSE (AGPL v3) for more details.
#
#    You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
#    (AGPL v3) along with this program.
#    If not, see <http://www.gnu.org/licenses/>.
#
################################################################################
from odoo import api, fields, models


class PurchaseOrderLine(models.Model):
    """
    Model for representing purchase order lines with additional fields and
    methods.
    Inherits from 'purchase.order.line' model.
    """
    _inherit = 'purchase.order.line'

    product_config_mode = fields.Selection(
        related='product_template_id.product_config_mode',
        depends=['product_template_id'],
        help="product configuration mode")
    product_custom_attribute_value_ids = fields.One2many(
        comodel_name='product.attribute.custom.value',
        inverse_name='purchase_order_line_id',
        string="Custom Values",
        compute='_compute_custom_attribute_values',
        help="product custom attribute values",
        store=True, readonly=False, precompute=True, copy=True)

    @api.depends('product_id')
    def _compute_custom_attribute_values(self):
        """
        Checks if the product has custom attribute values associated with it,
        and if those values belong to the valid values of the product template.
        """
        for line in self:
            if not line.product_id:
                line.product_custom_attribute_value_ids = False
                continue
            if not line.product_custom_attribute_value_ids:
                continue
            valid_values = line.product_id.product_tmpl_id. \
                valid_product_template_attribute_line_ids. \
                product_template_value_ids
            # remove the is_custom values that don't belong to this template
            for attribute in line.product_custom_attribute_value_ids:
                if attribute.custom_product_template_attribute_value_id not in \
                        valid_values:
                    line.product_custom_attribute_value_ids -= attribute

    def _prepare_stock_moves(self, picking):
        """
        Override to copy product_template_id and related fields from purchase order line
        to stock moves when creating receipts.
        """
        moves = super()._prepare_stock_moves(picking)
        # Get product_template_id - try from field first, then from product_id
        product_template_id = False
        if hasattr(self, 'product_template_id') and self.product_template_id:
            product_template_id = self.product_template_id.id
        elif self.product_id and self.product_id.product_tmpl_id:
            product_template_id = self.product_id.product_tmpl_id.id
        
        # Get product_template_attribute_value_ids
        product_template_attribute_value_ids = []
        if hasattr(self, 'product_template_attribute_value_ids') and self.product_template_attribute_value_ids:
            product_template_attribute_value_ids = self.product_template_attribute_value_ids.ids
        elif self.product_id and self.product_id.product_template_attribute_value_ids:
            product_template_attribute_value_ids = self.product_id.product_template_attribute_value_ids.ids
        
        # Get product_no_variant_attribute_value_ids
        # Note: This field exists on product.template, not product.product
        product_no_variant_attribute_value_ids = []
        if hasattr(self, 'product_no_variant_attribute_value_ids') and self.product_no_variant_attribute_value_ids:
            product_no_variant_attribute_value_ids = self.product_no_variant_attribute_value_ids.ids
        elif self.product_id and self.product_id.product_tmpl_id:
            # Get from product template
            product_template = self.product_id.product_tmpl_id
            if hasattr(product_template, 'product_no_variant_attribute_value_ids') and product_template.product_no_variant_attribute_value_ids:
                product_no_variant_attribute_value_ids = product_template.product_no_variant_attribute_value_ids.ids
        
        # Update each move with the product template information
        # Ensure the same variant (product_id) from purchase order is preserved in stock move
        # IMPORTANT: Always set product_id FIRST to preserve the variant, then set product_template_id
        for move_vals in moves:
            # CRITICAL: Always set product_id (variant) for ALL moves from this purchase order line
            # This ensures the variant selected in PO appears in the receipt
            if self.product_id:
                move_vals['product_id'] = self.product_id.id
            
            # Set product_template_id to ensure product configuration is preserved
            # Setting it after product_id ensures variant is preserved
            if product_template_id:
                move_vals['product_template_id'] = product_template_id
            
            # Copy attribute values to preserve variant configuration
            if product_template_attribute_value_ids:
                move_vals['product_template_attribute_value_ids'] = [(6, 0, product_template_attribute_value_ids)]
            
            if product_no_variant_attribute_value_ids:
                move_vals['product_no_variant_attribute_value_ids'] = [(6, 0, product_no_variant_attribute_value_ids)]
        return moves
