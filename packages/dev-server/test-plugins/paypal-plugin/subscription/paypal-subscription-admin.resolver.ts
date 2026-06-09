import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Logger, Permission, RequestContext } from '@vendure/core';
import { GraphQLError } from 'graphql';

import { loggerCtx } from '../constants';
import {
    CreateBillingPlanInput,
    extractSubscriptionErrorMessage,
    PaypalSubscriptionService,
} from './paypal-subscription.service';

@Resolver()
export class PaypalSubscriptionAdminResolver {
    constructor(private subscriptionService: PaypalSubscriptionService) {}

    // ---------------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------------

    @Allow(Permission.Authenticated)
    @Query()
    async paypalBillingPlans(
        @Ctx() _ctx: RequestContext,
        @Args('productId') productId?: string,
    ) {
        try {
            return await this.subscriptionService.listBillingPlans(productId);
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`paypalBillingPlans failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Query()
    async paypalBillingPlan(@Ctx() _ctx: RequestContext, @Args('planId') planId: string) {
        try {
            return await this.subscriptionService.getBillingPlan(planId);
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`paypalBillingPlan(${planId}) failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Query()
    async paypalSubscriptions(
        @Ctx() _ctx: RequestContext,
        @Args('planId') planId?: string,
        @Args('status') status?: string,
    ) {
        try {
            return await this.subscriptionService.listSubscriptions(planId, status);
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`paypalSubscriptions failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    // ---------------------------------------------------------------------------
    // Mutations
    // ---------------------------------------------------------------------------

    @Allow(Permission.Authenticated)
    @Mutation()
    async createPaypalBillingPlan(
        @Ctx() _ctx: RequestContext,
        @Args('input') input: CreateBillingPlanInput,
    ) {
        try {
            return await this.subscriptionService.createBillingPlan(input);
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`createPaypalBillingPlan failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Mutation()
    async activatePaypalBillingPlan(
        @Ctx() _ctx: RequestContext,
        @Args('planId') planId: string,
    ): Promise<boolean> {
        try {
            await this.subscriptionService.activateBillingPlan(planId);
            return true;
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`activatePaypalBillingPlan(${planId}) failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Mutation()
    async deactivatePaypalBillingPlan(
        @Ctx() _ctx: RequestContext,
        @Args('planId') planId: string,
    ): Promise<boolean> {
        try {
            await this.subscriptionService.deactivateBillingPlan(planId);
            return true;
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`deactivatePaypalBillingPlan(${planId}) failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Mutation()
    async cancelPaypalSubscription(
        @Ctx() _ctx: RequestContext,
        @Args('subscriptionId') subscriptionId: string,
        @Args('reason') reason?: string,
    ): Promise<boolean> {
        try {
            await this.subscriptionService.cancelSubscription(subscriptionId, reason);
            return true;
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`cancelPaypalSubscription(${subscriptionId}) failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Allow(Permission.Authenticated)
    @Mutation()
    async retryPaypalSubscriptionPayment(
        @Ctx() _ctx: RequestContext,
        @Args('subscriptionId') subscriptionId: string,
        @Args('amount') amount: string,
        @Args('currencyCode') currencyCode: string,
        @Args('note') note?: string,
    ): Promise<boolean> {
        try {
            await this.subscriptionService.retrySubscriptionPayment(
                subscriptionId,
                amount,
                currencyCode,
                note,
            );
            return true;
        } catch (err: unknown) {
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(
                `retryPaypalSubscriptionPayment(${subscriptionId}) failed: ${msg}`,
                loggerCtx,
            );
            throw new GraphQLError(msg);
        }
    }
}
