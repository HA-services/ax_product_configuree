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


class StockMove(models.Model):
    """
    Model for representing stock moves with additional fields and
    methods for product configuration.
    Inherits from 'stock.move' model.
    """
    _inherit = 'stock.move'

    product_template_id = fields.Many2one(
        'product.template',
        string='Product',
        domain=[('type', '!=', 'service')],
        help="Product template for configuration")
    is_configurable_product = fields.Boolean(
        'Is the product configurable?',
        related='product_template_id.has_configurable_attributes',
        help="Indicates if the product has configurable attributes")
    product_config_mode = fields.Selection(
        related='product_template_id.product_config_mode',
        depends=['product_template_id'],
        help="product configuration mode")
    product_custom_attribute_value_ids = fields.One2many(
        comodel_name='product.attribute.custom.value',
        inverse_name='stock_move_id',
        string="Custom Values",
        compute='_compute_custom_attribute_values',
        help="product custom attribute values",
        store=True, readonly=False, precompute=True, copy=True)
    product_template_attribute_value_ids = fields.Many2many(
        'product.template.attribute.value',
        relation='stock_move_product_template_attribute_value_rel',
        column1='stock_move_id',
        column2='product_template_attribute_value_id',
        string='Attribute Values',
        compute='_compute_product_template_attribute_value_ids',
        store=True,
        readonly=False,
        precompute=True,
        copy=True)
    product_no_variant_attribute_value_ids = fields.Many2many(
        'product.template.attribute.value',
        relation='stock_move_product_no_variant_attribute_value_rel',
        column1='stock_move_id',
        column2='product_template_attribute_value_id',
        string='No Variant Attributes',
        help='Product attribute values that do not create variants',
        ondelete='restrict')

    @api.depends('product_id', 'product_template_id')
    def _compute_custom_attribute_values(self):
        """
        Checks if the product has custom attribute values associated with it,
        and if those values belong to the valid values of the product template.
        """
        for move in self:
            if not move.product_id and not move.product_template_id:
                move.product_custom_attribute_value_ids = False
                continue
            if not move.product_custom_attribute_value_ids:
                continue
            product_tmpl = move.product_template_id or (move.product_id and move.product_id.product_tmpl_id)
            if not product_tmpl:
                continue
            valid_values = product_tmpl.valid_product_template_attribute_line_ids.product_template_value_ids
            # remove the is_custom values that don't belong to this template
            for attribute in move.product_custom_attribute_value_ids:
                if attribute.custom_product_template_attribute_value_id not in valid_values:
                    move.product_custom_attribute_value_ids -= attribute

    @api.depends('product_id')
    def _compute_product_template_attribute_value_ids(self):
        """Compute attribute values from product variant."""
        for move in self:
            if move.product_id:
                move.product_template_attribute_value_ids = move.product_id.product_template_attribute_value_ids
            else:
                move.product_template_attribute_value_ids = False

    @api.model_create_multi
    def create(self, vals_list):
        """
        Override create to ensure product_id (variant) is preserved when creating stock moves.
        This ensures that when a variant is selected in purchase order, the same variant appears in receipt.
        """
        for vals in vals_list:
            # If product_id is set but product_template_id is not, set it from product_id
            if vals.get('product_id') and not vals.get('product_template_id'):
                product = self.env['product.product'].browse(vals['product_id'])
                if product.exists():
                    vals['product_template_id'] = product.product_tmpl_id.id
            
            # CRITICAL: If product_template_id is set but product_id is not set,
            # and product_id was provided in vals, preserve it
            # This prevents product_id from being cleared when product_template_id is set
            if vals.get('product_template_id') and vals.get('product_id'):
                # Verify that product_id belongs to product_template_id
                product = self.env['product.product'].browse(vals['product_id'])
                if product.exists() and product.product_tmpl_id.id == vals['product_template_id']:
                    # Product matches template - keep it
                    pass
                else:
                    # Product doesn't match template - this shouldn't happen, but preserve product_id anyway
                    # The variant from purchase order should be preserved
                    pass
        
        return super().create(vals_list)

    @api.onchange('product_id')
    def _onchange_product_id(self):
        """When product_id changes, set product_template_id if not already set."""
        for move in self:
            if move.product_id and not move.product_template_id:
                # Set product_template_id from product_id as fallback
                move.product_template_id = move.product_id.product_tmpl_id

    @api.onchange('product_template_id')
    def _onchange_product_template_id(self):
        """When product_template_id changes, update product_id if template has single variant.
        IMPORTANT: Preserves existing product_id (variant) if it matches the template.
        This ensures that when a variant is selected in purchase order, the same variant appears in receipt.
        """
        for move in self:
            if move.product_template_id:
                # CRITICAL: If product_id is already set and matches the template, preserve it
                # This ensures that when variant is selected in purchase order, same variant appears in receipt
                if move.product_id and move.product_id.product_tmpl_id == move.product_template_id:
                    # Variant matches template - preserve it, don't change
                    continue
                
                # Check if template has a single variant
                try:
                    result = move.product_template_id.get_single_product_variant()
                    if result and result.get('product_id'):
                        # Only set product_id if it's not already set
                        if not move.product_id:
                            move.product_id = result['product_id']
                    else:
                        # Configurable product - product_id will be set by configurator
                        # Only clear if current product_id doesn't belong to this template
                        if move.product_id and move.product_id.product_tmpl_id != move.product_template_id:
                            move.product_id = False
                except Exception:
                    # If method doesn't exist or fails, preserve existing product_id if it matches template
                    if move.product_id and move.product_id.product_tmpl_id != move.product_template_id:
                        move.product_id = False
            else:
                # If template is cleared, don't automatically clear product_id
                # It might have been set from purchase order line
                pass

