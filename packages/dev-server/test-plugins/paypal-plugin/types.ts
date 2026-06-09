export interface PaypalPluginOptions {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox' | 'production';
    /**
     * URL PayPal redirects the buyer to after they approve the payment.
     * Required for the redirect flow. Should point to the storefront page
     * that will call addPaymentToOrder with the returned paypalOrderId.
     * Example: 'https://my-store.com/checkout/paypal-return'
     */
    returnUrl: string;
    /**
     * URL PayPal redirects the buyer to if they cancel on the PayPal approval page.
     * Example: 'https://my-store.com/checkout/paypal-cancel'
     */
    cancelUrl: string;
}
