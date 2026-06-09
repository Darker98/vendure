import { LanguageCode, Logger, PaymentMethodHandler } from '@vendure/core';
import {
    ApiError,
    AuthorizationStatus,
    CaptureStatus,
    CheckoutPaymentIntent,
    CustomError,
    OrdersController,
    PaymentsController,
    RefundStatus,
} from '@paypal/paypal-server-sdk';

import { loggerCtx } from '../constants';
import { getPayPalClient } from '../paypal-client';
import { PaypalPlugin } from '../paypal.plugin';

/**
 * PayPal payment handler — supports both:
 *
 *  Feature 1: Standard Checkout (Immediate Capture)
 *    - createPaypalOrder(intent: CAPTURE) on the Shop API
 *    - addPaymentToOrder → createPayment captures immediately → state "Settled"
 *    - settlePayment is a no-op
 *
 *  Feature 2: Authorize-then-Capture
 *    - createPaypalOrder(intent: AUTHORIZE) on the Shop API
 *    - addPaymentToOrder → createPayment authorizes → state "Authorized"
 *    - Admin calls settlePayment (e.g. at shipment) → captures the authorization
 *
 * The `intent` arg on the payment method (configured in the admin UI) drives
 * which path is taken. Default is CAPTURE.
 */
export const paypalPaymentHandler = new PaymentMethodHandler({
    code: 'paypal',
    description: [{ languageCode: LanguageCode.en, value: 'PayPal' }],
    args: {
        intent: {
            type: 'string' as const,
            label: [{ languageCode: LanguageCode.en, value: 'Payment Intent' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value:
                        'CAPTURE: funds are collected immediately when the buyer approves. ' +
                        'AUTHORIZE: funds are reserved now and captured later (e.g. at shipment).',
                },
            ],
            options: [
                {
                    value: 'CAPTURE',
                    label: [{ languageCode: LanguageCode.en, value: 'Capture (immediate payment)' }],
                },
                {
                    value: 'AUTHORIZE',
                    label: [{ languageCode: LanguageCode.en, value: 'Authorize (capture at fulfillment)' }],
                },
            ],
            defaultValue: 'CAPTURE',
        },
    },

    async createPayment(_ctx, _order, amount, args, metadata) {
        const paypalOrderId = (metadata as Record<string, unknown>).paypalOrderId as string | undefined;

        if (!paypalOrderId || typeof paypalOrderId !== 'string' || paypalOrderId.trim() === '') {
            Logger.warn('addPaymentToOrder called without a paypalOrderId in metadata', loggerCtx);
            return {
                amount,
                state: 'Declined' as const,
                errorMessage:
                    'Missing paypalOrderId in payment metadata. ' +
                    'Complete the PayPal approval step before calling addPaymentToOrder.',
            };
        }

        try {
            const client = getPayPalClient(PaypalPlugin.options);
            const ordersController = new OrdersController(client);

            // Fetch the PayPal order to determine its actual intent.
            // This is authoritative — we never trust the storefront metadata for intent
            // because a mismatch (e.g. CAPTURE order + AUTHORIZE metadata) causes a
            // 422 ACTION_DOES_NOT_MATCH_INTENT error from PayPal.
            const orderDetails = await ordersController.getOrder({ id: paypalOrderId });
            const paypalIntent = orderDetails.result.intent;

            Logger.verbose(
                `PayPal order ${paypalOrderId} has intent: ${paypalIntent}`,
                loggerCtx,
            );

            if (paypalIntent === CheckoutPaymentIntent.Authorize) {
                return await authorizeOrder(ordersController, paypalOrderId, amount);
            } else {
                return await captureOrder(ordersController, paypalOrderId, amount);
            }
        } catch (err: unknown) {
            const message = extractErrorMessage(err);
            Logger.error(`PayPal createPayment failed for order ${paypalOrderId}: ${message}`, loggerCtx);
            return {
                amount,
                state: 'Declined' as const,
                errorMessage: message,
                metadata: { paypalOrderId, errorDetail: extractErrorDetail(err) },
            };
        }
    },

    async cancelPayment(_ctx, _order, payment, _args) {
        const meta = payment.metadata as Record<string, unknown>;
        const authorizationId = meta?.authorizationId as string | undefined;

        // A CAPTURE-intent payment (already Settled) cannot be voided.
        // Refunds for settled payments are handled by createRefund (Features 4 & 5).
        if (!authorizationId) {
            return {
                success: false as const,
                errorMessage:
                    'This payment was captured immediately and cannot be voided. ' +
                    'Use a refund instead.',
            };
        }

        Logger.verbose(`Voiding PayPal authorization ${authorizationId}`, loggerCtx);

        try {
            const client = getPayPalClient(PaypalPlugin.options);
            const paymentsController = new PaymentsController(client);

            // voidPayment returns 204 No Content on success (result is null).
            // The SDK throws ApiError on any 4xx/5xx, so reaching the line below means success.
            await paymentsController.voidPayment({
                authorizationId,
                prefer: 'return=minimal',
            });

            Logger.verbose(`PayPal authorization ${authorizationId} voided successfully`, loggerCtx);

            return {
                success: true as const,
                metadata: {
                    ...meta,
                    authorizationStatus: 'VOIDED',
                },
            };
        } catch (err: unknown) {
            const message = extractErrorMessage(err);
            Logger.error(
                `PayPal void failed for authorization ${authorizationId}: ${message}`,
                loggerCtx,
            );
            return {
                success: false as const,
                errorMessage: message,
                metadata: { authorizationId, errorDetail: extractErrorDetail(err) },
            };
        }
    },

    async settlePayment(_ctx, _order, payment, _args) {
        const meta = payment.metadata as Record<string, unknown>;
        const authorizationId = meta?.authorizationId as string | undefined;

        // CAPTURE path: payment was already settled inside createPayment.
        if (!authorizationId) {
            return { success: true };
        }

        // AUTHORIZE path: capture the reserved funds now.
        Logger.verbose(
            `Capturing authorized payment. AuthorizationId: ${authorizationId}`,
            loggerCtx,
        );

        try {
            const client = getPayPalClient(PaypalPlugin.options);
            const paymentsController = new PaymentsController(client);

            const response = await paymentsController.captureAuthorizedPayment({
                authorizationId,
                prefer: 'return=representation',
            });

            const captured = response.result;

            if (captured.status !== CaptureStatus.Completed) {
                Logger.warn(
                    `PayPal capture for authorization ${authorizationId} returned status: ${captured.status}`,
                    loggerCtx,
                );
                return {
                    success: false as const,
                    errorMessage: `PayPal capture returned status: ${captured.status}`,
                    metadata: {
                        ...meta,
                        captureId: captured.id,
                        captureStatus: captured.status,
                    },
                };
            }

            Logger.verbose(
                `Authorization ${authorizationId} captured successfully. CaptureId: ${captured.id}`,
                loggerCtx,
            );

            return {
                success: true as const,
                metadata: {
                    ...meta,
                    captureId: captured.id,
                    captureStatus: captured.status,
                },
            };
        } catch (err: unknown) {
            const message = extractErrorMessage(err);
            Logger.error(
                `PayPal settlePayment failed for authorization ${authorizationId}: ${message}`,
                loggerCtx,
            );
            return {
                success: false as const,
                errorMessage: message,
                metadata: { authorizationId, errorDetail: extractErrorDetail(err) },
            };
        }
    },
    async createRefund(_ctx, _input, amount, order, payment, _args) {
        const meta = payment.metadata as Record<string, unknown>;
        const captureId = meta?.captureId as string | undefined;

        if (!captureId) {
            return {
                state: 'Failed' as const,
                metadata: {
                    error:
                        'No captureId found on this payment. Only fully captured payments ' +
                        '(CAPTURE intent) can be refunded. Authorized-only payments should be voided instead.',
                },
            };
        }

        // Convert Vendure's integer amount (e.g. 1099 = $10.99) to PayPal's decimal string.
        // Passing the explicit amount works for both full and partial refunds.
        // Multiple partial refunds can be issued against the same capture up to the
        // original captured total.
        const refundAmount = (amount / 100).toFixed(2);
        const currencyCode = order.currencyCode as string;

        Logger.verbose(
            `Issuing refund of ${currencyCode} ${refundAmount} for PayPal capture ${captureId}`,
            loggerCtx,
        );

        try {
            const client = getPayPalClient(PaypalPlugin.options);
            const paymentsController = new PaymentsController(client);

            const response = await paymentsController.refundCapturedPayment({
                captureId,
                prefer: 'return=representation',
                body: {
                    amount: {
                        currencyCode,
                        value: refundAmount,
                    },
                },
            });

            const refund = response.result;

            if (
                refund.status !== RefundStatus.Completed &&
                refund.status !== RefundStatus.Pending
            ) {
                Logger.warn(
                    `PayPal refund for capture ${captureId} returned status: ${refund.status}`,
                    loggerCtx,
                );
                return {
                    state: 'Failed' as const,
                    transactionId: refund.id,
                    metadata: {
                        captureId,
                        refundId: refund.id,
                        refundStatus: refund.status,
                    },
                };
            }

            const refundState = refund.status === RefundStatus.Completed ? 'Settled' : 'Pending';

            Logger.verbose(
                `PayPal full refund for capture ${captureId} — refundId: ${refund.id}, status: ${refund.status}`,
                loggerCtx,
            );

            return {
                state: refundState as 'Settled' | 'Pending',
                transactionId: refund.id,
                metadata: {
                    captureId,
                    refundId: refund.id,
                    refundStatus: refund.status,
                    refundAmount: refund.amount,
                },
            };
        } catch (err: unknown) {
            const message = extractErrorMessage(err);
            Logger.error(`PayPal full refund failed for capture ${captureId}: ${message}`, loggerCtx);
            return {
                state: 'Failed' as const,
                metadata: { captureId, errorDetail: extractErrorDetail(err) },
            };
        }
    },
});

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function captureOrder(
    ordersController: OrdersController,
    paypalOrderId: string,
    amount: number,
) {
    Logger.verbose(`Capturing PayPal order ${paypalOrderId}`, loggerCtx);

    const response = await ordersController.captureOrder({
        id: paypalOrderId,
        prefer: 'return=representation',
    });

    const capturedOrder = response.result;

    if (capturedOrder.status !== 'COMPLETED') {
        Logger.warn(
            `PayPal capture for order ${paypalOrderId} returned status: ${capturedOrder.status}`,
            loggerCtx,
        );
        return {
            amount,
            state: 'Declined' as const,
            errorMessage: `PayPal capture returned status: ${capturedOrder.status}`,
            metadata: { paypalOrderId, paypalStatus: capturedOrder.status },
        };
    }

    const captureId = capturedOrder.purchaseUnits?.[0]?.payments?.captures?.[0]?.id;

    Logger.verbose(
        `PayPal order ${paypalOrderId} captured. CaptureId: ${captureId}`,
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
}

async function authorizeOrder(
    ordersController: OrdersController,
    paypalOrderId: string,
    amount: number,
) {
    Logger.verbose(`Authorizing PayPal order ${paypalOrderId}`, loggerCtx);

    const response = await ordersController.authorizeOrder({
        id: paypalOrderId,
        prefer: 'return=representation',
    });

    const authorizedOrder = response.result;
    const authorization = authorizedOrder.purchaseUnits?.[0]?.payments?.authorizations?.[0];
    const authorizationId = authorization?.id;
    const authStatus = authorization?.status;

    const validStatuses: (AuthorizationStatus | undefined)[] = [
        AuthorizationStatus.Created,
        AuthorizationStatus.Pending,
    ];

    if (!authorizationId || !validStatuses.includes(authStatus)) {
        Logger.warn(
            `PayPal authorization for order ${paypalOrderId} returned unexpected status: ${authStatus}`,
            loggerCtx,
        );
        return {
            amount,
            state: 'Declined' as const,
            errorMessage: `PayPal authorization returned status: ${authStatus ?? 'unknown'}`,
            metadata: {
                paypalOrderId,
                authorizationStatus: authStatus,
            },
        };
    }

    Logger.verbose(
        `PayPal order ${paypalOrderId} authorized. AuthorizationId: ${authorizationId}`,
        loggerCtx,
    );

    return {
        amount,
        state: 'Authorized' as const,
        transactionId: authorizationId,
        metadata: {
            paypalOrderId,
            authorizationId,
            authorizationStatus: authStatus,
        },
    };
}

/**
 * Extracts a short human-readable message (≤ 250 chars) suitable for
 * Payment.errorMessage (varchar 255). Full error detail should go into
 * payment metadata so nothing is lost.
 */
function extractErrorMessage(err: unknown): string {
    let message: string;

    if (err instanceof CustomError) {
        const result = (err as CustomError).result as any;
        const name = result?.name ?? 'PAYPAL_ERROR';
        const detail = result?.message ?? result?.details?.[0]?.description ?? '';
        message = `[${(err as ApiError).statusCode}] ${name}: ${detail}`;
    } else if (err instanceof ApiError) {
        message = `PayPal API error [${(err as ApiError).statusCode}]`;
    } else if (err instanceof Error) {
        message = err.message || `${err.constructor.name} (no message)`;
    } else {
        message = 'Unknown PayPal error';
    }

    // Hard cap to stay within the varchar(255) errorMessage column.
    return message.length > 250 ? message.substring(0, 247) + '...' : message;
}

/**
 * Extracts the full error detail as a plain object for storage in metadata.
 * Not subject to the varchar(255) limit.
 */
function extractErrorDetail(err: unknown): Record<string, unknown> {
    if (err instanceof CustomError) {
        return { statusCode: (err as ApiError).statusCode, body: (err as CustomError).result };
    }
    if (err instanceof ApiError) {
        return { statusCode: (err as ApiError).statusCode, body: (err as ApiError).body };
    }
    if (err instanceof Error) {
        return { message: err.message, name: err.constructor.name };
    }
    return { raw: String(err) };
}
