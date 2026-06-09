import { Client, Environment } from '@paypal/paypal-server-sdk';

import { PaypalPluginOptions } from './types';

let client: Client | null = null;

/**
 * Returns a singleton PayPal SDK client, initialised lazily on first call.
 * Calling code must ensure PaypalPlugin.options is populated before the first
 * request is handled (guaranteed by the NestJS bootstrap order).
 */
export function getPayPalClient(options: PaypalPluginOptions): Client {
    if (!client) {
        client = new Client({
            clientCredentialsAuthCredentials: {
                oAuthClientId: options.clientId,
                oAuthClientSecret: options.clientSecret,
            },
            environment:
                options.environment === 'production' ? Environment.Production : Environment.Sandbox,
        });
    }
    return client;
}

/**
 * Destroys the cached client instance.
 * Useful in tests or when credentials change at runtime.
 */
export function resetPayPalClient(): void {
    client = null;
}
