import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import {
    ApiError,
    IntervalUnit,
    SubscriptionError,
    SubscriptionsController,
    TenureType,
} from '@paypal/paypal-server-sdk';

import { loggerCtx } from '../constants';
import { getPayPalClient } from '../paypal-client';
import { PaypalPlugin } from '../paypal.plugin';
import { PaypalSubscriptionRecord } from './entities/paypal-subscription.entity';

export interface CreateBillingPlanInput {
    productId: string;
    name: string;
    description?: string;
    intervalUnit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
    intervalCount: number;
    price: string;
    currencyCode: string;
    cycles?: number;
    trialIntervalUnit?: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
    trialIntervalCount?: number;
    trialPrice?: string;
    trialCycles?: number;
}

export interface BillingPlanResult {
    id: string;
    name: string;
    status: string;
    description?: string;
    productId?: string;
    createTime?: string;
    updateTime?: string;
}

export interface SubscriptionInfoResult {
    id: string;
    planId: string;
    status: string;
    startTime?: string;
    createTime?: string;
    approvalUrl?: string;
    vendureRecordId?: string;
}

export interface CreateSubscriptionResult {
    subscriptionId: string;
    approvalUrl: string;
}

@Injectable()
export class PaypalSubscriptionService {
    constructor(private connection: TransactionalConnection) {}

    // ---------------------------------------------------------------------------
    // Billing Plan operations
    // ---------------------------------------------------------------------------

    async createBillingPlan(input: CreateBillingPlanInput): Promise<BillingPlanResult> {
        const controller = this.getController();
        const billingCycles = this.buildBillingCycles(input);

        const response = await controller.createBillingPlan({
            prefer: 'return=representation',
            body: {
                productId: input.productId,
                name: input.name,
                description: input.description,
                billingCycles,
                paymentPreferences: {
                    autoBillOutstanding: true,
                    setupFeeFailureAction: 'CANCEL' as any,
                    paymentFailureThreshold: 3,
                },
                status: 'ACTIVE' as any,
            },
        });

        const plan = response.result;
        Logger.verbose(`Created PayPal billing plan: ${plan.id} (${plan.name})`, loggerCtx);
        return this.mapPlan(plan);
    }

    async listBillingPlans(productId?: string): Promise<BillingPlanResult[]> {
        const controller = this.getController();
        const response = await controller.listBillingPlans({
            prefer: 'return=representation',
            productId,
            pageSize: 20,
        });
        return (response.result.plans ?? []).map(p => this.mapPlan(p));
    }

    async getBillingPlan(planId: string): Promise<BillingPlanResult> {
        const controller = this.getController();
        const response = await controller.getBillingPlan(planId);
        return this.mapPlan(response.result);
    }

    async activateBillingPlan(planId: string): Promise<void> {
        const controller = this.getController();
        await controller.activateBillingPlan(planId);
        Logger.verbose(`Activated PayPal billing plan: ${planId}`, loggerCtx);
    }

    async deactivateBillingPlan(planId: string): Promise<void> {
        const controller = this.getController();
        await controller.deactivateBillingPlan(planId);
        Logger.verbose(`Deactivated PayPal billing plan: ${planId}`, loggerCtx);
    }

    // ---------------------------------------------------------------------------
    // Subscription operations
    // ---------------------------------------------------------------------------

    async createSubscription(
        ctx: RequestContext,
        planId: string,
        customerId?: string,
    ): Promise<CreateSubscriptionResult> {
        const controller = this.getController();
        const { returnUrl, cancelUrl } = PaypalPlugin.options;

        const response = await controller.createSubscription({
            prefer: 'return=representation',
            body: {
                planId,
                applicationContext: {
                    returnUrl,
                    cancelUrl,
                    userAction: 'SUBSCRIBE_NOW' as any,
                },
            } as any,
        });

        const subscription = response.result;
        const approveLink = (subscription.links ?? []).find((l: any) => l.rel === 'approve');

        if (!subscription.id || !approveLink?.href) {
            throw new Error(
                `PayPal createSubscription returned unexpected response: ` +
                `id=${subscription.id}, approve link present=${!!approveLink}`,
            );
        }

        // Persist tracking record
        const repo = this.connection.rawConnection.getRepository(PaypalSubscriptionRecord);
        const record = repo.create({
            paypalSubscriptionId: subscription.id,
            paypalPlanId: planId,
            vendureCustomerId: customerId ?? null,
            status: (subscription as any).status ?? 'APPROVAL_PENDING',
            approvalUrl: approveLink.href,
            metadata: {
                startTime: (subscription as any).startTime,
                createTime: (subscription as any).createTime,
            },
        });
        await repo.save(record);

        Logger.verbose(
            `Created PayPal subscription ${subscription.id} for plan ${planId}`,
            loggerCtx,
        );

        return { subscriptionId: subscription.id, approvalUrl: approveLink.href };
    }

    async cancelSubscription(subscriptionId: string, reason?: string): Promise<void> {
        const controller = this.getController();
        await controller.cancelSubscription({
            id: subscriptionId,
            body: reason ? { reason } : undefined,
        });

        // Sync status in our DB
        const repo = this.connection.rawConnection.getRepository(PaypalSubscriptionRecord);
        await repo.update({ paypalSubscriptionId: subscriptionId }, { status: 'CANCELLED' });

        Logger.verbose(`Cancelled PayPal subscription: ${subscriptionId}`, loggerCtx);
    }

    async activateSubscription(subscriptionId: string): Promise<void> {
        const controller = this.getController();
        await controller.activateSubscription({ id: subscriptionId });

        const repo = this.connection.rawConnection.getRepository(PaypalSubscriptionRecord);
        await repo.update({ paypalSubscriptionId: subscriptionId }, { status: 'ACTIVE' });

        Logger.verbose(`Activated PayPal subscription: ${subscriptionId}`, loggerCtx);
    }

    async retrySubscriptionPayment(
        subscriptionId: string,
        amount: string,
        currencyCode: string,
        note?: string,
    ): Promise<void> {
        const controller = this.getController();
        await controller.captureSubscription({
            id: subscriptionId,
            body: {
                note: note ?? 'Retrying failed payment',
                captureType: 'OUTSTANDING_BALANCE' as any,
                amount: {
                    currencyCode,
                    value: amount,
                } as any,
            },
        });

        Logger.verbose(`Retried payment for PayPal subscription: ${subscriptionId}`, loggerCtx);
    }

    async listSubscriptions(planId?: string, status?: string): Promise<SubscriptionInfoResult[]> {
        const repo = this.connection.rawConnection.getRepository(PaypalSubscriptionRecord);
        const where: Record<string, string> = {};
        if (planId) where.paypalPlanId = planId;
        if (status) where.status = status;

        const records = await repo.find({ where: where as any });

        return records.map(r => ({
            id: r.paypalSubscriptionId,
            planId: r.paypalPlanId,
            status: r.status,
            approvalUrl: r.approvalUrl ?? undefined,
            vendureRecordId: String(r.id),
            createTime: r.createdAt?.toISOString(),
        }));
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private getController(): SubscriptionsController {
        return new SubscriptionsController(getPayPalClient(PaypalPlugin.options));
    }

    private buildBillingCycles(input: CreateBillingPlanInput): any[] {
        const cycles: any[] = [];
        let sequence = 1;

        if (
            input.trialIntervalUnit &&
            input.trialIntervalCount &&
            input.trialPrice !== undefined
        ) {
            cycles.push({
                frequency: {
                    intervalUnit: input.trialIntervalUnit as IntervalUnit,
                    intervalCount: input.trialIntervalCount,
                },
                tenureType: TenureType.Trial,
                sequence,
                totalCycles: input.trialCycles ?? 1,
                pricingScheme: {
                    fixedPrice: {
                        value: input.trialPrice,
                        currencyCode: input.currencyCode,
                    },
                },
            });
            sequence++;
        }

        cycles.push({
            frequency: {
                intervalUnit: input.intervalUnit as IntervalUnit,
                intervalCount: input.intervalCount,
            },
            tenureType: TenureType.Regular,
            sequence,
            totalCycles: input.cycles ?? 0,
            pricingScheme: {
                fixedPrice: {
                    value: input.price,
                    currencyCode: input.currencyCode,
                },
            },
        });

        return cycles;
    }

    private mapPlan(plan: any): BillingPlanResult {
        return {
            id: plan.id ?? '',
            name: plan.name ?? '',
            status: plan.status ?? '',
            description: plan.description ?? undefined,
            productId: plan.productId ?? undefined,
            createTime: plan.createTime ?? undefined,
            updateTime: plan.updateTime ?? undefined,
        };
    }
}

/**
 * Extracts a safe error message from a SubscriptionError or generic Error.
 * Keeps it short for logging; full detail should be re-thrown as GraphQLError.
 */
export function extractSubscriptionErrorMessage(err: unknown): string {
    if (err instanceof SubscriptionError) {
        const result = (err as any).result as any;
        const name = result?.name ?? 'SUBSCRIPTION_ERROR';
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
    return 'Unknown PayPal subscription error';
}
