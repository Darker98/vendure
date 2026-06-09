import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Tracks PayPal subscriptions locally so the admin can query, cancel, and
 * retry payments without hitting PayPal's list endpoint every time.
 */
@Entity()
export class PaypalSubscriptionRecord extends VendureEntity {
    constructor(input?: DeepPartial<PaypalSubscriptionRecord>) {
        super(input);
    }

    /** PayPal-assigned subscription ID (e.g. I-BW452GLLEP1G). */
    @Index()
    @Column()
    paypalSubscriptionId: string;

    /** The billing plan this subscription runs on. */
    @Column()
    paypalPlanId: string;

    /**
     * Vendure Customer ID — set when the customer initiates the subscription
     * through the Shop API. Null for merchant-created subscriptions.
     */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    vendureCustomerId: string | null;

    /**
     * Mirrors the PayPal subscription status:
     * APPROVAL_PENDING | APPROVED | ACTIVE | SUSPENDED | CANCELLED | EXPIRED
     */
    @Column({ default: 'APPROVAL_PENDING' })
    status: string;

    /** Buyer-approval URL returned by PayPal at creation time. */
    @Column({ type: 'text', nullable: true })
    approvalUrl: string | null;

    /** Additional PayPal response fields (start_time, subscriber, etc.). */
    @Column('simple-json', { nullable: true })
    metadata: Record<string, unknown> | null;
}
