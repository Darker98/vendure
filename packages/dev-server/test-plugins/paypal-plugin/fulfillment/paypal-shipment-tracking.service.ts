import { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import {
    EventBus,
    FulfillmentStateTransitionEvent,
    Logger,
    TransactionalConnection,
} from '@vendure/core';
import { Fulfillment } from '@vendure/core';
import { ApiError, CustomError, OrdersController, ShipmentCarrier } from '@paypal/paypal-server-sdk';

import { loggerCtx } from '../constants';
import { getPayPalClient } from '../paypal-client';
import { PaypalPlugin } from '../paypal.plugin';

/**
 * Subscribes to FulfillmentStateTransitionEvent. When a fulfillment transitions
 * to the 'Shipped' state, this service pushes the carrier + tracking number to
 * PayPal via the Orders tracking API so the buyer can see shipment details in
 * their PayPal account.
 *
 * - Only processes fulfillments linked to orders that have a settled PayPal
 *   payment (captureId present in payment.metadata).
 * - Errors are logged and swallowed — tracking delivery must never block the
 *   state transition or the fulfillment flow.
 */
@Injectable()
export class PaypalShipmentTrackingService implements OnModuleInit {
    constructor(
        private eventBus: EventBus,
        private connection: TransactionalConnection,
    ) {}

    onModuleInit() {
        this.eventBus
            .ofType(FulfillmentStateTransitionEvent)
            .subscribe(event => {
                if (event.toState !== 'Shipped') return;
                // Fire-and-forget: errors must not propagate into the event pipeline.
                this.pushTrackingForFulfillment(event).catch(err => {
                    Logger.error(
                        `Unhandled error in PayPal shipment tracking hook: ${err?.message ?? err}`,
                        loggerCtx,
                    );
                });
            });
    }

    // ---------------------------------------------------------------------------
    // Private implementation
    // ---------------------------------------------------------------------------

    private async pushTrackingForFulfillment(
        event: FulfillmentStateTransitionEvent,
    ): Promise<void> {
        const { ctx, fulfillment: partialFulfillment } = event;

        // Re-fetch with relations — the event entity may not have orders/payments loaded.
        const fulfillment = await this.connection
            .getRepository(ctx, Fulfillment)
            .findOne({
                where: { id: partialFulfillment.id },
                relations: ['orders', 'orders.payments'],
            });

        if (!fulfillment) {
            Logger.warn(
                `PayPal shipment tracking: fulfillment ${partialFulfillment.id} not found.`,
                loggerCtx,
            );
            return;
        }

        for (const order of fulfillment.orders ?? []) {
            for (const payment of order.payments ?? []) {
                if (payment.method !== 'paypal') continue;

                const meta = payment.metadata as Record<string, unknown>;
                const captureId = meta?.captureId as string | undefined;
                const paypalOrderId = meta?.paypalOrderId as string | undefined;

                if (!captureId || !paypalOrderId) continue;

                await this.pushTrackingToPayPal({
                    paypalOrderId,
                    captureId,
                    trackingCode: fulfillment.trackingCode,
                    handlerCode: fulfillment.handlerCode,
                    orderCode: order.code,
                });
            }
        }
    }

    private async pushTrackingToPayPal(params: {
        paypalOrderId: string;
        captureId: string;
        trackingCode: string;
        handlerCode: string;
        orderCode: string;
    }): Promise<void> {
        const { paypalOrderId, captureId, trackingCode, handlerCode, orderCode } = params;

        const { carrier, carrierNameOther } = resolveCarrier(handlerCode);

        Logger.verbose(
            `Pushing shipment tracking to PayPal for order ${orderCode} — ` +
            `paypalOrder=${paypalOrderId}, capture=${captureId}, ` +
            `carrier=${carrier}, tracking=${trackingCode || '(none)'}`,
            loggerCtx,
        );

        try {
            const client = getPayPalClient(PaypalPlugin.options);
            const ordersController = new OrdersController(client);

            await ordersController.createOrderTracking({
                id: paypalOrderId,
                body: {
                    captureId,
                    trackingNumber: trackingCode || undefined,
                    carrier,
                    carrierNameOther,
                    // Notify the buyer by email that their order has shipped.
                    notifyPayer: true,
                },
            });

            Logger.verbose(
                `Shipment tracking pushed to PayPal for order ${orderCode}.`,
                loggerCtx,
            );
        } catch (err: unknown) {
            // Log but never throw — tracking failure must not affect fulfillment state.
            Logger.error(
                `PayPal shipment tracking failed for order ${orderCode} ` +
                `(capture ${captureId}): ${extractTrackingErrorMessage(err)}`,
                loggerCtx,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Carrier resolution
// ---------------------------------------------------------------------------

/**
 * Maps a Vendure fulfillment handler code or shipping method name to a PayPal
 * ShipmentCarrier enum value.
 *
 * Common codes are mapped directly. Anything unrecognised falls back to
 * ShipmentCarrier.Other so the tracking record is still created in PayPal;
 * the raw handler code is passed as carrierNameOther.
 */
function resolveCarrier(handlerCode: string): {
    carrier: ShipmentCarrier;
    carrierNameOther?: string;
} {
    const normalized = handlerCode.toUpperCase().replace(/[-\s]/g, '_');

    const knownCarriers: Record<string, ShipmentCarrier> = {
        UPS: ShipmentCarrier.Ups,
        UPS_API: ShipmentCarrier.UpsApi,
        FEDEX: ShipmentCarrier.Fedex,
        FEDEX_API: ShipmentCarrier.FedexApi,
        USPS: ShipmentCarrier.Usps,
        USPS_API: ShipmentCarrier.UspsApi,
        DHL: ShipmentCarrier.Dhl,
        DHL_API: ShipmentCarrier.DhlApi,
        DE_DHL: ShipmentCarrier.DeDhl,
        DHL_EXPRESS: ShipmentCarrier.DhlActiveTracing,
        PUROLATOR: ShipmentCarrier.Purolator,
    };

    const matched = knownCarriers[normalized];
    if (matched) {
        return { carrier: matched };
    }

    return {
        carrier: ShipmentCarrier.Other,
        carrierNameOther: handlerCode.substring(0, 64),
    };
}

function extractTrackingErrorMessage(err: unknown): string {
    if (err instanceof CustomError) {
        const result = (err as CustomError).result as any;
        return `[${(err as ApiError).statusCode}] ${result?.name ?? 'ERROR'}: ${result?.message ?? ''}`;
    }
    if (err instanceof ApiError) {
        return `PayPal API error [${(err as ApiError).statusCode}]`;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
