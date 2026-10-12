import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Les clés d'idempotence sont propres à l'utilisateur authentifié.
 * L'ancien index global pouvait révéler l'identifiant d'une action d'un autre
 * compte lorsqu'un client réutilisait son clientId.
 */
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
    // Rétablir la contrainte historique peut échouer si deux utilisateurs ont
    // créé le même clientId après cette migration. Cette migration ne supprime
    // ni ne fusionne les actions.
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Action_clientId_key" ON "Action" ("clientId")',
    );
  }
}
