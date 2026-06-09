import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Ctx,
    isGraphQlErrorResult,
    Logger,
    OrderService,
    RequestContext,
} from '@vendure/core';
import {
    ApiError,
    CheckoutPaymentIntent,
    CustomError,
    OrderApplicationContextUserAction,
    OrdersController,
} from '@paypal/paypal-server-sdk';
import { GraphQLError } from 'graphql';

import { loggerCtx } from '../constants';
import { getPayPalClient } from '../paypal-client';
import { PaypalPlugin } from '../paypal.plugin';

interface PaypalOrderResult {
    paypalOrderId: string;
    approvalUrl: string;
}

/**
 * Converts a Vendure money integer (e.g. 1099 = $10.99) to PayPal's decimal
 * string format (e.g. "10.99").
 *
 * NOTE: assumes a 2-decimal-place currency (USD, EUR, GBP, etc.).
 */
function toPaypalAmount(vendureAmount: number): string {
    return (vendureAmount / 100).toFixed(2);
}

@Resolver()
export class PaypalShopResolver {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    @Mutation()
    async createPaypalOrder(
        @Ctx() ctx: RequestContext,
        @Args('intent') intent: 'CAPTURE' | 'AUTHORIZE' = 'CAPTURE',
    ): Promise<PaypalOrderResult> {
        if (!ctx.session) {
            throw new GraphQLError(
                'No active session. Include the vendure-auth-token from your previous ' +
                'request as an Authorization: Bearer <token> header.',
            );
        }

        const order = await this.activeOrderService.getOrderFromContext(ctx);
        if (!order) {
            throw new GraphQLError(
                'No active order found. Add at least one item to your cart before calling createPaypalOrder.',
            );
        }

        const { clientId, clientSecret } = PaypalPlugin.options;
        if (!clientId || !clientSecret) {
            throw new GraphQLError(
                'PayPal credentials are not configured. ' +
                'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your .env file and restart the server.',
            );
        }

        // Transition the order to ArrangingPayment if it is still in AddingItems.
        // This locks the order against further item changes and is required by
        // Vendure before addPaymentToOrder can be called.
        if (order.state === 'AddingItems') {
            Logger.verbose(
                `Transitioning order ${order.code} from AddingItems → ArrangingPayment`,
                loggerCtx,
            );
            const transitionResult = await this.orderService.transitionToState(
                ctx,
                order.id,
                'ArrangingPayment',
            );
            if (isGraphQlErrorResult(transitionResult)) {
                throw new GraphQLError(
                    `Could not transition order to ArrangingPayment: ${transitionResult.transitionError}. ` +
                    'Make sure a shipping address and shipping method are set on the order if required.',
                );
            }
        } else if (order.state !== 'ArrangingPayment') {
            throw new GraphQLError(
                `Order is in state "${order.state}" and cannot accept a new payment. ` +
                'Only orders in AddingItems or ArrangingPayment state can create a PayPal order.',
            );
        }

        const client = getPayPalClient(PaypalPlugin.options);
        const ordersController = new OrdersController(client);

        const amountValue = toPaypalAmount(order.totalWithTax);
        const currencyCode = order.currencyCode as string;
        const { returnUrl, cancelUrl } = PaypalPlugin.options;

        const paypalIntent =
            intent === 'AUTHORIZE'
                ? CheckoutPaymentIntent.Authorize
                : CheckoutPaymentIntent.Capture;

        Logger.verbose(
            `Creating PayPal order (intent: ${intent}) for Vendure order ${order.code} — ${currencyCode} ${amountValue}`,
            loggerCtx,
        );

        try {
            const response = await ordersController.createOrder({
                body: {
                    intent: paypalIntent,
                    purchaseUnits: [
                        {
                            referenceId: order.code,
                            amount: {
                                currencyCode,
                                value: amountValue,
                            },
                        },
                    ],
                    // returnUrl/cancelUrl are required for the redirect flow.
                    // userAction: PAY_NOW shows "Pay Now" instead of "Continue",
                    // which is correct for both immediate-capture and authorize intents.
                    applicationContext: {
                        returnUrl,
                        cancelUrl,
                        userAction: OrderApplicationContextUserAction.PayNow,
                    },
                },
                prefer: 'return=minimal',
            });

            const paypalOrder = response.result;
            if (!paypalOrder?.id) {
                throw new GraphQLError('PayPal returned a response without an order ID. Please try again.');
            }

            const approveLink = paypalOrder.links?.find(link => link.rel === 'approve');
            if (!approveLink?.href) {
                throw new GraphQLError(
                    'PayPal did not return an approval URL. ' +
                    `Order status: ${paypalOrder.status ?? 'unknown'}. Please try again.`,
                );
            }

            Logger.verbose(`PayPal order created: ${paypalOrder.id} (intent: ${intent})`, loggerCtx);

            return {
                paypalOrderId: paypalOrder.id,
                approvalUrl: approveLink.href,
            };
        } catch (err: unknown) {
            if (err instanceof GraphQLError) {
                throw err;
            }

            let message: string;

            if (err instanceof CustomError) {
                message = `PayPal API error [${(err as ApiError).statusCode}]: ${JSON.stringify((err as CustomError).result)}`;
            } else if (err instanceof ApiError) {
                message = `PayPal API error [${(err as ApiError).statusCode}]: ${JSON.stringify((err as ApiError).body)}`;
            } else if (err instanceof Error) {
                message = err.message || `PayPal SDK threw an error with no message (${err.constructor.name})`;
            } else {
                message = `Unexpected error: ${JSON.stringify(err)}`;
            }

            Logger.error(`createPaypalOrder failed: ${message}`, loggerCtx);
            throw new GraphQLError(message);
        }
    }
}
