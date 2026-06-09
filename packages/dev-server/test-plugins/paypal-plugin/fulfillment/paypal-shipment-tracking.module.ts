import { Module } from '@nestjs/common';
import { PluginCommonModule } from '@vendure/core';

import { PaypalShipmentTrackingService } from './paypal-shipment-tracking.service';

@Module({
    imports: [PluginCommonModule],
    providers: [PaypalShipmentTrackingService],
})
export class PaypalShipmentTrackingModule {}
