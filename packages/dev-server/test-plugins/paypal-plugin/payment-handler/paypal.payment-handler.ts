import { LanguageCode, Logger, PaymentMethodHandler } from '@vendure/core';
import { ApiError, CustomError, OrdersController } from '@paypal/paypal-server-sdk';

import { loggerCtx } from '../constants';
import { getPayPalClient } from '../paypal-client';
import { PaypalPlugin } from '../paypal.plugin';

/**
 * PayPal payment handler — Standard Checkout (Immediate Capture).
 *
 * Expected storefront flow:
 *  1. Storefront calls `createPaypalOrder` mutation → receives { paypalOrderId, approvalUrl }.
 *  2. Buyer approves the order via PayPal (redirect or embedded JS SDK).
 *  3. Storefront calls `addPaymentToOrder` with:
 *       input: { method: "paypal", metadata: { paypalOrderId: "<id>" } }
 *  4. `createPayment` captures the approved PayPal order and returns state "Settled".
 *
 * The `settlePayment` hook is a no-op because the payment is already settled
 * inside `createPayment` for this immediate-capture path.
 */
export const paypalPaymentHandler = new PaymentMethodHandler({
    code: 'paypal',
    description: [{ languageCode: LanguageCode.en, value: 'PayPal' }],
    args: {},

    async createPayment(_ctx, _order, amount, _args, metadata) {
        const paypalOrderId = (metadata as Record<string, unknown>).paypalOrderId as string | undefined;

        if (!paypalOrderId || typeof paypalOrderId !== 'string' || paypalOrderId.trim() === '') {
            Logger.warn('addPaymentToOrder called without a paypalOrderId in metadata', loggerCtx);
            return {
                amount,
                state: 'Declined' as const,
                errorMessage: 'Missing paypalOrderId in payment metadata. Complete the PayPal approval step first.',
            };
        }

        try {
            const client = getPayPalClient(PaypalPlugin.options);
            const ordersController = new OrdersController(client);

            Logger.verbose(`Capturing PayPal order ${paypalOrderId}`, loggerCtx);

            const response = await ordersController.captureOrder({
                id: paypalOrderId,
                prefer: 'return=representation',
            });

            const capturedOrder = response.result;

            if (capturedOrder.status !== 'COMPLETED') {
                Logger.warn(
                    `PayPal capture for order ${paypalOrderId} returned unexpected status: ${capturedOrder.status}`,
                    loggerCtx,
                );
                return {
                    amount,
                    state: 'Declined' as const,
                    errorMessage: `PayPal capture returned status: ${capturedOrder.status}`,
                    metadata: {
                        paypalOrderId,
                        paypalStatus: capturedOrder.status,
                    },
                };
            }

            const captureId =
                capturedOrder.purchaseUnits?.[0]?.payments?.captures?.[0]?.id;

            Logger.verbose(
                `PayPal order ${paypalOrderId} captured successfully. CaptureId: ${captureId}`,
                loggerCtx,
            );

            return {
                amount,
                state: 'Settled' as const,
                transactionId: captureId ?? paypalOrderId,
                metadata: {
                    paypalOrderId,
                    captureId: captureId ?? null,
                    paypalStatus: capturedOrder.status,
                },
            };
        } catch (err: unknown) {
            const isApiError = err instanceof ApiError;
            const isCustomError = err instanceof CustomError;

            const statusCode = isApiError ? (err as ApiError).statusCode : undefined;
            const body = isApiError ? (err as ApiError).body : undefined;
            const message =
                err instanceof Error ? err.message : 'Unknown PayPal error';

            Logger.error(
                `PayPal capture failed for order ${paypalOrderId}: [${statusCode ?? 'N/A'}] ${message}`,
                loggerCtx,
            );

            if (isCustomError) {
                Logger.error(
                    `PayPal error details: ${JSON.stringify((err as CustomError).result)}`,
                    loggerCtx,
                );
            }

            return {
                amount,
                state: 'Declined' as const,
                errorMessage: `PayPal capture failed: ${message}`,
                metadata: {
                    paypalOrderId,
                    errorStatusCode: statusCode,
                    errorBody: body,
                },
            };
        }
    },

    async settlePayment(_ctx, _order, _payment, _args) {
        // The payment was already captured (settled) inside createPayment.
        // This no-op satisfies Vendure's two-step interface.
        return { success: true };
    },
});
