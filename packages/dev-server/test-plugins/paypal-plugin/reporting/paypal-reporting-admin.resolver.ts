import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Logger, Permission, RequestContext } from '@vendure/core';
import { ApiError, DefaultError, SearchError, TransactionSearchController } from '@paypal/paypal-server-sdk';
import { GraphQLError } from 'graphql';

import { loggerCtx } from '../constants';
import { getPayPalClient } from '../paypal-client';
import { PaypalPlugin } from '../paypal.plugin';

@Resolver()
export class PaypalReportingAdminResolver {

    @Allow(Permission.Authenticated)
    @Query()
    async paypalTransactions(
        @Ctx() _ctx: RequestContext,
        @Args('startDate') startDate: string,
        @Args('endDate') endDate: string,
        @Args('transactionId') transactionId?: string,
        @Args('transactionStatus') transactionStatus?: string,
        @Args('transactionCurrency') transactionCurrency?: string,
        @Args('pageSize') pageSize?: number,
        @Args('page') page?: number,
    ) {
        this.validateDateRange(startDate, endDate);

        const controller = new TransactionSearchController(getPayPalClient(PaypalPlugin.options));

        Logger.verbose(
            `Fetching PayPal transactions ${startDate} → ${endDate} (page ${page ?? 1})`,
            loggerCtx,
        );

        try {
            const response = await controller.searchTransactions({
                startDate,
                endDate,
                transactionId,
                transactionStatus,
                transactionCurrency,
                // Always request all fields so callers get the full picture.
                fields: 'all',
                pageSize: pageSize ?? 100,
                page: page ?? 1,
            });

            const result = response.result as any;

            const transactions = (result.transactionDetails ?? []).map((detail: any) =>
                mapTransactionDetail(detail),
            );

            return {
                transactions,
                totalItems: result.totalItems ?? transactions.length,
                totalPages: result.totalPages ?? 1,
                page: result.page ?? 1,
            };
        } catch (err: unknown) {
            const msg = extractReportingErrorMessage(err);
            Logger.error(`paypalTransactions query failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Query()
    async paypalAccountBalances(
        @Ctx() _ctx: RequestContext,
        @Args('currencyCode') currencyCode?: string,
        @Args('asOfTime') asOfTime?: string,
    ) {
        const controller = new TransactionSearchController(getPayPalClient(PaypalPlugin.options));

        Logger.verbose(`Fetching PayPal account balances`, loggerCtx);

        try {
            const response = await controller.searchBalances({
                currencyCode,
                asOfTime,
            });

            const result = response.result as any;

            const balances = (result.balances ?? []).map((b: any) => ({
                currency: b.currency ?? '',
                primary: b.primary ?? false,
                totalBalance: mapMoney(b.totalBalance),
                availableBalance: mapMoney(b.availableBalance),
                withheldBalance: mapMoney(b.withheldBalance),
            }));

            return {
                accountId: result.accountId ?? null,
                asOfTime: result.asOfTime ?? null,
                lastRefreshTime: result.lastRefreshTime ?? null,
                balances,
            };
        } catch (err: unknown) {
            const msg = extractReportingErrorMessage(err);
            Logger.error(`paypalAccountBalances query failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private validateDateRange(startDate: string, endDate: string): void {
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new GraphQLError(
                'startDate and endDate must be valid RFC 3339 timestamps, e.g. "2024-01-01T00:00:00Z".',
            );
        }
        if (end <= start) {
            throw new GraphQLError('endDate must be after startDate.');
        }

        // PayPal enforces a maximum 31-day range for transaction search.
        const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 31) {
            throw new GraphQLError(
                `Date range is ${Math.round(diffDays)} days. PayPal transaction search supports a maximum of 31 days per query.`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapMoney(m: any): { value: string; currencyCode: string } | null {
    if (!m) return null;
    return { value: m.value ?? '0', currencyCode: m.currencyCode ?? '' };
}

function mapTransactionDetail(detail: any): object {
    const ti = detail.transactionInfo ?? {};
    const pi = detail.payerInfo ?? {};

    return {
        transactionInfo: {
            transactionId: ti.transactionId ?? null,
            transactionType: ti.transactionEventCode ?? null,
            transactionStatus: ti.transactionStatus ?? null,
            transactionAmount: mapMoney(ti.transactionAmount),
            feeAmount: mapMoney(ti.feeAmount),
            netAmount: mapMoney(ti.transactionAmount && ti.feeAmount
                ? computeNet(ti.transactionAmount, ti.feeAmount)
                : ti.transactionAmount),
            transactionInitiationDate: ti.transactionInitiationDate ?? null,
            transactionUpdatedDate: ti.transactionUpdatedDate ?? null,
            customField: ti.customField ?? null,
            invoiceId: ti.invoiceId ?? null,
            paypalReferenceId: ti.paypalReferenceId ?? null,
        },
        payerInfo: {
            accountId: pi.accountId ?? null,
            emailAddress: pi.emailAddress ?? null,
            phoneNumber: pi.phoneNumber?.nationalNumber ?? null,
            addressStatus: pi.addressStatus ?? null,
            payerStatus: pi.payerStatus ?? null,
            countryCode: pi.countryCode ?? null,
            payerName: formatPayerName(pi.payerName),
        },
    };
}

function computeNet(
    amount: { value?: string; currencyCode?: string },
    fee: { value?: string; currencyCode?: string },
): { value: string; currencyCode: string } {
    const a = parseFloat(amount.value ?? '0');
    const f = parseFloat(fee.value ?? '0');
    return {
        value: (a + f).toFixed(2),
        currencyCode: amount.currencyCode ?? fee.currencyCode ?? '',
    };
}

function formatPayerName(name: any): string | null {
    if (!name) return null;
    const parts = [name.givenName, name.surname].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
}

function extractReportingErrorMessage(err: unknown): string {
    if (err instanceof SearchError || err instanceof DefaultError) {
        const result = (err as any).result as any;
        const name = result?.name ?? 'REPORTING_ERROR';
        const detail = result?.message ?? result?.details?.[0]?.description ?? '';
        const msg = `[${(err as ApiError).statusCode}] ${name}: ${detail}`;
        return msg.length > 500 ? msg.substring(0, 497) + '...' : msg;
    }
    if (err instanceof ApiError) {
        return `PayPal API error [${(err as ApiError).statusCode}]`;
    }
    if (err instanceof Error) {
        return err.message || `${err.constructor.name} (no message)`;
    }
    return 'Unknown PayPal reporting error';
}
