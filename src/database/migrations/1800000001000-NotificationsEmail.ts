import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationsEmail1800000001000 implements MigrationInterface {
  name = 'NotificationsEmail1800000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "EmailOutbox" (
        "id" text NOT NULL,
        "cleIdempotence" text NOT NULL,
        "typeEvenement" text NOT NULL,
        "destinataire" text NOT NULL,
        "langue" varchar(5),
        "sujet" text NOT NULL,
        "texte" text NOT NULL,
        "html" text NOT NULL,
        "statut" text NOT NULL DEFAULT 'EN_ATTENTE',
        "tentatives" integer NOT NULL DEFAULT 0,
        "prochainEnvoiA" TIMESTAMP(3) NOT NULL DEFAULT now(),
        "envoyeA" TIMESTAMP(3),
        "dernierCodeErreur" text,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        CONSTRAINT "PK_EmailOutbox" PRIMARY KEY ("id"),
        CONSTRAINT "CK_EmailOutbox_statut"
          CHECK ("statut" IN ('EN_ATTENTE','EN_COURS','ENVOYE','ECHEC'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_EmailOutbox_cleIdempotence"
        ON "EmailOutbox" ("cleIdempotence")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "EmailOutbox_statut_prochain_idx"
        ON "EmailOutbox" ("statut", "prochainEnvoiA")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "PasswordSetupToken" (
        "id" text NOT NULL,
        "utilisateurId" text NOT NULL,
        "tokenHash" text NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PasswordSetupToken" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "PasswordSetupToken_tokenHash_key"
        ON "PasswordSetupToken" ("tokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "PasswordSetupToken_utilisateur_idx"
        ON "PasswordSetupToken" ("utilisateurId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "PasswordSetupToken_expiresAt_idx"
        ON "PasswordSetupToken" ("expiresAt")
    `);

    await queryRunner.query(`
      ALTER TABLE "PasswordSetupToken"
        ADD CONSTRAINT "FK_PasswordSetupToken_utilisateur"
        FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "PasswordSetupToken"
        DROP CONSTRAINT IF EXISTS "FK_PasswordSetupToken_utilisateur"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "PasswordSetupToken_expiresAt_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "PasswordSetupToken_utilisateur_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "PasswordSetupToken_tokenHash_key"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "PasswordSetupToken"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "EmailOutbox_statut_prochain_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_EmailOutbox_cleIdempotence"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailOutbox"`);
  }
}
