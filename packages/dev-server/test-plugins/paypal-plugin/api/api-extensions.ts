import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    type PaypalOrderResult {
        """The PayPal order ID to pass back to addPaymentToOrder once the buyer has approved."""
        paypalOrderId: String!
        """The URL to redirect the buyer to for approval (redirect flow)."""
        approvalUrl: String!
    }

    """
    Controls whether the PayPal order is created with immediate-capture or
    authorize-then-capture intent.
    """
    enum PaypalOrderIntent {
        """
        Funds are captured immediately after the buyer approves.
        addPaymentToOrder will return a Settled payment.
        """
        CAPTURE
        """
        Funds are reserved (authorized) after the buyer approves but are
        not moved yet. The admin captures them later via settlePayment
        (e.g. at the time of shipment).
        """
        AUTHORIZE
    }

    extend type Mutation {
        """
        Creates a PayPal order for the current active Order and automatically
        transitions that Order to the ArrangingPayment state.

        Returns the PayPal order ID and buyer-approval URL.

        After the buyer approves, call addPaymentToOrder with:
          input: { method: "paypal", metadata: { paypalOrderId: "<id>" } }
        """
        createPaypalOrder(intent: PaypalOrderIntent): PaypalOrderResult!
    }
`;
