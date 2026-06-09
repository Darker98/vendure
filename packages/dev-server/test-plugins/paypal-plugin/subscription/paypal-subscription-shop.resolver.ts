import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ActiveOrderService, Ctx, Logger, RequestContext } from '@vendure/core';
import { GraphQLError } from 'graphql';

import { loggerCtx } from '../constants';
import {
    extractSubscriptionErrorMessage,
    PaypalSubscriptionService,
} from './paypal-subscription.service';

@Resolver()
export class PaypalSubscriptionShopResolver {
    constructor(
        private subscriptionService: PaypalSubscriptionService,
        private activeOrderService: ActiveOrderService,
    ) {}

    @Mutation()
    async createPaypalSubscription(
        @Ctx() ctx: RequestContext,
        @Args('planId') planId: string,
    ) {
        if (!ctx.session) {
            throw new GraphQLError(
                'No active session. Include your auth token as an Authorization: Bearer header.',
            );
        }

        if (!planId?.trim()) {
            throw new GraphQLError('planId is required to create a subscription.');
        }

        try {
            const customerId = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
            return await this.subscriptionService.createSubscription(ctx, planId, customerId);
        } catch (err: unknown) {
            if (err instanceof GraphQLError) throw err;
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(`createPaypalSubscription failed: ${msg}`, loggerCtx);
            throw new GraphQLError(msg);
        }
    }

    @Mutation()
    async cancelMyPaypalSubscription(
        @Ctx() ctx: RequestContext,
        @Args('subscriptionId') subscriptionId: string,
        @Args('reason') reason?: string,
    ): Promise<boolean> {
        if (!ctx.session) {
            throw new GraphQLError(
                'No active session. Include your auth token as an Authorization: Bearer header.',
            );
        }

        if (!subscriptionId?.trim()) {
            throw new GraphQLError('subscriptionId is required.');
        }

        try {
            await this.subscriptionService.cancelSubscription(subscriptionId, reason);
            return true;
        } catch (err: unknown) {
            if (err instanceof GraphQLError) throw err;
            const msg = extractSubscriptionErrorMessage(err);
            Logger.error(
                `cancelMyPaypalSubscription(${subscriptionId}) failed: ${msg}`,
                loggerCtx,
            );
            throw new GraphQLError(msg);
        }
    }
}
