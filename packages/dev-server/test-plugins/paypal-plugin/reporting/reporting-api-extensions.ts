import gql from 'graphql-tag';

export const reportingAdminApiExtensions = gql`
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

    extend type Query {
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
`;
