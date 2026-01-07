# -*- coding: utf-8 -*-

{
    'name': 'Axsync Product Configure',
    'category': 'Purchases',
    "website":"axsync.com",
    'author': 'Axsync Global',
    'summary': 'Advanced Variant Select Wizard for Purchase & Inventory',

    "license": "LGPL-3",
    'depends': ['purchase_product_matrix', 'stock'],
    'data': [
        'views/optional_product_template.xml',
        'views/purchase_order_views.xml',
        'views/product_template_views.xml',
        'views/stock_move_views.xml'
    ],
    'assets': {
        'web.assets_backend': [
            'axsync_product_configure/static/src/js/purchase_product_field.js',
            'axsync_product_configure/static/src/js/stock_move_product_field.js',
            'axsync_product_configure/static/src/js/stock_move_product_field.xml',
            'axsync_product_configure/static/src/js/product_configurator_dialog/product_configurator_dialog.js',
            'axsync_product_configure/static/src/js/product_configurator_dialog/product_configurator_dialog.xml',
            'axsync_product_configure/static/src/js/product_list/product_list.js',
            'axsync_product_configure/static/src/js/product_list/product_list.xml',
            'axsync_product_configure/static/src/js/product/product.js',
            'axsync_product_configure/static/src/js/product/product_template.xml',
            'axsync_product_configure/static/src/js/quantity_buttons/quantity_buttons.js',
            'axsync_product_configure/static/src/js/quantity_buttons/quantity_buttons.xml',
            'axsync_product_configure/static/src/js/product_template_attribute_line/product_template_attribute_line.js',
            'axsync_product_configure/static/src/js/product_template_attribute_line/product_template_attribute_line.xml',
            'axsync_product_configure/static/src/js/product/product.scss',
            'axsync_product_configure/static/src/js/product_list/product_list.scss',
            'axsync_product_configure/static/src/js/product_template_attribute_line/product_template_attribute_line.scss'
        ],
    },
    'installable':True,
    'auto_install':False,
    'application':True,
    'currency':'USD',
    'price':'19.00',
    'images':['static/description/ban.png']
}
