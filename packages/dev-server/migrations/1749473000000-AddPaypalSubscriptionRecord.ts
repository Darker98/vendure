import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaypalSubscriptionRecord1749473000000 implements MigrationInterface {
    name = 'AddPaypalSubscriptionRecord1749473000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS \`paypal_subscription_record\` (
                \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`paypalSubscriptionId\` varchar(255) NOT NULL,
                \`paypalPlanId\` varchar(255) NOT NULL,
                \`vendureCustomerId\` varchar(255) NULL,
                \`status\` varchar(255) NOT NULL DEFAULT 'APPROVAL_PENDING',
                \`approvalUrl\` text NULL,
                \`metadata\` text NULL,
                INDEX \`IDX_paypal_sub_subscription_id\` (\`paypalSubscriptionId\`),
                INDEX \`IDX_paypal_sub_customer_id\` (\`vendureCustomerId\`),
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`paypal_subscription_record\``);
    }
}
