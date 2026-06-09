import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './admin-api-extensions';
import { shopApiExtensions } from './api/api-extensions';
import { PaypalShopResolver } from './api/paypal-shop.resolver';
import { PAYPAL_PLUGIN_OPTIONS } from './constants';
import { paypalPaymentHandler } from './payment-handler/paypal.payment-handler';
import { PaypalReportingAdminResolver } from './reporting/paypal-reporting-admin.resolver';
import { PaypalSubscriptionRecord } from './subscription/entities/paypal-subscription.entity';
import { PaypalSubscriptionAdminResolver } from './subscription/paypal-subscription-admin.resolver';
import { PaypalSubscriptionModule } from './subscription/paypal-subscription.module';
import { PaypalSubscriptionShopResolver } from './subscription/paypal-subscription-shop.resolver';
import { PaypalPluginOptions } from './types';

/**
 * PayPal payment integration plugin for Vendure.
 *
 * Features implemented:
 *  1. Standard checkout / immediate capture (CAPTURE intent)
 *  2. Authorize-then-capture (AUTHORIZE intent)
 *  3. Payment cancellation / void
 *  4. Full refund
 *  5. Partial refund
 *  6. Subscription billing (recurring payments)
 *  7. Transaction reporting (search + account balances)
 *
 * Usage:
 * ```ts
 * PaypalPlugin.init({
 *   clientId: process.env.PAYPAL_CLIENT_ID!,
 *   clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
 *   environment: 'sandbox',
 *   returnUrl: 'https://my-store.com/checkout/paypal-return',
 *   cancelUrl: 'https://my-store.com/checkout/paypal-cancel',
 * })
 * ```
 */
@VendurePlugin({
    imports: [PluginCommonModule, PaypalSubscriptionModule],
    entities: [PaypalSubscriptionRecord],
    providers: [
        {
            provide: PAYPAL_PLUGIN_OPTIONS,
            useFactory: () => PaypalPlugin.options,
        },
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [PaypalShopResolver, PaypalSubscriptionShopResolver],
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            PaypalSubscriptionAdminResolver,
            PaypalReportingAdminResolver,
        ],
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
