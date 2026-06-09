import { Module } from '@nestjs/common';
import { PluginCommonModule } from '@vendure/core';

import { PaypalSubscriptionService } from './paypal-subscription.service';

/**
 * NestJS submodule for the subscription feature.
 * Only the service is registered here — resolvers are registered via the
 * plugin's adminApiExtensions/shopApiExtensions so that Vendure places them
 * in the correct API context rather than NestJS auto-discovering them.
 */
@Module({
    imports: [PluginCommonModule],
    providers: [PaypalSubscriptionService],
    exports: [PaypalSubscriptionService],
})
export class PaypalSubscriptionModule {}
