import gql from 'graphql-tag';

/**
 * Shop API extensions — covers:
 *   Features 1-5: one-time PayPal order flow (createPaypalOrder)
 *   Feature 6:    subscription flow (createPaypalSubscription, cancelMyPaypalSubscription)
 */
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

    type PaypalSubscriptionResult {
        """The PayPal subscription ID to track the subscription."""
        subscriptionId: String!
        """URL to redirect the customer to for PayPal approval of the recurring charges."""
        approvalUrl: String!
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

        """
        Creates a new PayPal subscription for the authenticated customer using
        the specified billing plan ID.

        Returns the subscription ID and buyer-approval URL. The customer must
        approve the subscription at the approval URL before charges can begin.
        After approval, PayPal activates the subscription automatically.
        """
        createPaypalSubscription(planId: String!): PaypalSubscriptionResult!

        """
        Cancels an active PayPal subscription belonging to the authenticated customer.
        Returns true on success.
        """
        cancelMyPaypalSubscription(subscriptionId: String!, reason: String): Boolean!
    }
`;
