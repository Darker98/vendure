import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    type PaypalOrderResult {
        """The PayPal order ID to pass back to addPaymentToOrder once the buyer has approved."""
        paypalOrderId: String!
        """The URL to redirect the buyer to for approval (redirect flow)."""
        approvalUrl: String!
    }

    extend type Mutation {
        """
        Creates a PayPal order for the current active Order.
        Returns the PayPal order ID and approval URL.
        The storefront must direct the buyer to the approvalUrl (redirect flow)
        or use the PayPal JS SDK with the paypalOrderId (embedded flow).
        After buyer approval, call addPaymentToOrder with
        metadata: { paypalOrderId: "<id>" } to capture the payment.
        """
        createPaypalOrder: PaypalOrderResult!
    }
`;
