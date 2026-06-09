import gql from 'graphql-tag';

/**
 * Combined Admin API schema for the PayPal plugin.
 * Covers Feature 6 (Subscription Billing) and Feature 7 (Transaction Reporting).
 * A single DocumentNode is required by Vendure's adminApiExtensions.schema field.
 */
export const adminApiExtensions = gql`
    # -------------------------------------------------------------------------
    # Feature 6 — Subscription Billing
    # -------------------------------------------------------------------------

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

    # -------------------------------------------------------------------------
    # Feature 7 — Transaction Reporting
    # -------------------------------------------------------------------------

    type PaypalMoneyAmount {
        value: String!
        currencyCode: String!
    }

    type PaypalTransactionInfo {
        """PayPal-assigned transaction ID (17 or 19 chars)."""
        transactionId: String
        """PayPal event code that classifies the transaction (e.g. T0001 = PayPal payment)."""
        transactionType: String
        """
        Status code: S = Success, P = Pending, D = Denied, V = Reversed.
        Note: transactions may take up to 3 hours to appear.
        """
        transactionStatus: String
        transactionAmount: PaypalMoneyAmount
        feeAmount: PaypalMoneyAmount
        netAmount: PaypalMoneyAmount
        transactionInitiationDate: String
        transactionUpdatedDate: String
        customField: String
        invoiceId: String
        paypalReferenceId: String
    }

    type PaypalPayerInfo {
        accountId: String
        emailAddress: String
        phoneNumber: String
        addressStatus: String
        payerStatus: String
        countryCode: String
        payerName: String
    }

    type PaypalTransactionDetail {
        transactionInfo: PaypalTransactionInfo
        payerInfo: PaypalPayerInfo
    }

    type PaypalTransactionReport {
        transactions: [PaypalTransactionDetail!]!
        """Total number of transactions matching the query."""
        totalItems: Int
        """Total pages available at the requested pageSize."""
        totalPages: Int
        page: Int
    }

    type PaypalBalanceInfo {
        """ISO-4217 currency code."""
        currency: String!
        primary: Boolean
        totalBalance: PaypalMoneyAmount
        availableBalance: PaypalMoneyAmount
        withheldBalance: PaypalMoneyAmount
    }

    type PaypalAccountBalances {
        accountId: String
        """Timestamp of when the balance snapshot was taken (RFC 3339)."""
        asOfTime: String
        lastRefreshTime: String
        balances: [PaypalBalanceInfo!]!
    }

    # -------------------------------------------------------------------------
    # Queries
    # -------------------------------------------------------------------------

    extend type Query {
        """Lists all billing plans, optionally filtered by PayPal product ID."""
        paypalBillingPlans(productId: String): [PaypalBillingPlan!]!
        """Returns details for a single billing plan."""
        paypalBillingPlan(planId: String!): PaypalBillingPlan!
        """Lists locally tracked subscriptions, optionally filtered by plan or status."""
        paypalSubscriptions(planId: String, status: String): [PaypalSubscriptionInfo!]!

        """
        Searches PayPal transactions for a date range (max 31 days).
        Results may be delayed up to 3 hours after execution.
        startDate / endDate must be RFC 3339 strings with seconds, e.g. "2024-01-01T00:00:00Z".
        """
        paypalTransactions(
            startDate: String!
            endDate: String!
            transactionId: String
            transactionStatus: String
            transactionCurrency: String
            pageSize: Int
            page: Int
        ): PaypalTransactionReport!

        """
        Returns current PayPal account balance(s).
        Optionally filter by ISO-4217 currency code or supply an asOfTime (RFC 3339)
        to retrieve a historical snapshot. Data may be up to 3 hours delayed.
        """
        paypalAccountBalances(
            currencyCode: String
            asOfTime: String
        ): PaypalAccountBalances!
    }

    # -------------------------------------------------------------------------
    # Mutations
    # -------------------------------------------------------------------------

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
