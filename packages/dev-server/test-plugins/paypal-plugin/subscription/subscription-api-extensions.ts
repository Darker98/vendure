import gql from 'graphql-tag';

/**
 * Admin API — billing plan and subscription management for merchants.
 */
export const subscriptionAdminApiExtensions = gql`
    type PaypalBillingPlan {
        """PayPal billing plan ID (e.g. P-XXXXXXXXXXXXXXXX)."""
        id: String!
        name: String!
        status: String!
        description: String
        productId: String
        createTime: String
        updateTime: String
    }

    type PaypalSubscriptionInfo {
        """PayPal subscription ID (e.g. I-XXXXXXXXXXXXXXXX)."""
        id: String!
        planId: String!
        status: String!
        startTime: String
        createTime: String
        approvalUrl: String
        """ID of the local PaypalSubscriptionRecord entity, if available."""
        vendureRecordId: String
    }

    input CreatePaypalBillingPlanInput {
        """PayPal Product ID to attach this plan to (must exist in the PayPal Catalog)."""
        productId: String!
        name: String!
        description: String
        intervalUnit: PaypalBillingIntervalUnit!
        intervalCount: Int!
        """Recurring price as a decimal string, e.g. "9.99"."""
        price: String!
        currencyCode: String!
        """Total billing cycles. 0 = infinite."""
        cycles: Int
        trialIntervalUnit: PaypalBillingIntervalUnit
        trialIntervalCount: Int
        trialPrice: String
        trialCycles: Int
    }

    """Billing frequency unit for PayPal subscription plans."""
    enum PaypalBillingIntervalUnit {
        DAY
        WEEK
        MONTH
        YEAR
    }

    extend type Query {
        """Lists all billing plans, optionally filtered by PayPal product ID."""
        paypalBillingPlans(productId: String): [PaypalBillingPlan!]!
        """Returns details for a single billing plan."""
        paypalBillingPlan(planId: String!): PaypalBillingPlan!
        """Lists locally tracked subscriptions, optionally filtered by plan or status."""
        paypalSubscriptions(planId: String, status: String): [PaypalSubscriptionInfo!]!
    }

    extend type Mutation {
        """Creates a new PayPal billing plan and activates it."""
        createPaypalBillingPlan(input: CreatePaypalBillingPlanInput!): PaypalBillingPlan!
        """Activates an existing billing plan so it can accept new subscriptions."""
        activatePaypalBillingPlan(planId: String!): Boolean!
        """Deactivates a billing plan so it no longer accepts new subscriptions."""
        deactivatePaypalBillingPlan(planId: String!): Boolean!
        """Cancels an active subscription. Returns true on success."""
        cancelPaypalSubscription(subscriptionId: String!, reason: String): Boolean!
        """
        Retries a failed subscription payment by capturing the outstanding balance.
        amount must be a decimal string matching the subscription currency (e.g. "9.99").
        """
        retryPaypalSubscriptionPayment(
            subscriptionId: String!
            amount: String!
            currencyCode: String!
            note: String
        ): Boolean!
    }
`;
