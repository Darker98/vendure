import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import { PaypalShopResolver } from './api/paypal-shop.resolver';
import { PAYPAL_PLUGIN_OPTIONS } from './constants';
import { paypalPaymentHandler } from './payment-handler/paypal.payment-handler';
import { PaypalPluginOptions } from './types';

/**
 * PayPal payment integration plugin for Vendure.
 *
 * Covers:
 *  - Feature 1: Standard checkout with immediate capture (CAPTURE intent)
 *
 * Usage:
 * ```ts
 * PaypalPlugin.init({
 *   clientId: process.env.PAYPAL_CLIENT_ID!,
 *   clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
 *   environment: 'sandbox',
 * })
 * ```
 *
 * The plugin registers the `paypal` PaymentMethodHandler and exposes a
 * `createPaypalOrder` mutation on the Shop API.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        {
            provide: PAYPAL_PLUGIN_OPTIONS,
            useFactory: () => PaypalPlugin.options,
        },
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [PaypalShopResolver],
    },
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(paypalPaymentHandler);
        return config;
    },
    compatibility: '^3.0.0',
})
export class PaypalPlugin {
    static options: PaypalPluginOptions;

    static init(options: PaypalPluginOptions): typeof PaypalPlugin {
        this.options = options;
        return PaypalPlugin;
    }
}
