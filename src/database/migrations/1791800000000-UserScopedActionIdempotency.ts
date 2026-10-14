import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserScopedActionIdempotency1791800000000
  implements MigrationInterface
{
  name = 'UserScopedActionIdempotency1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "Action_clientId_key"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Action_userId_clientId_key" ON "Action" ("userId", "clientId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "Action_userId_clientId_key"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Action_clientId_key" ON "Action" ("clientId")',
    );
  }
}
