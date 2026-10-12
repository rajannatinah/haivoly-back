import { MigrationInterface, QueryRunner } from 'typeorm';

export class VerificationEmail1760000000000 implements MigrationInterface {
  name = 'VerificationEmail1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD COLUMN "estVerifie" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD COLUMN "emailVerifieA" TIMESTAMP(3)
    `);

    // Comptes antérieurs à la politique : considérés vérifiés.
    await queryRunner.query(`
      UPDATE "Utilisateur" SET "estVerifie" = true, "emailVerifieA" = NOW()
    `);

    await queryRunner.query(`
      CREATE TABLE "EmailVerificationToken" (
        "id" text NOT NULL,
        "email" text NOT NULL,
        "tokenHash" text NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "utilisateurId" text,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
        CONSTRAINT "PK_EmailVerificationToken" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
        ON "EmailVerificationToken" ("tokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX "EmailVerificationToken_email_idx"
        ON "EmailVerificationToken" ("email")
    `);
    await queryRunner.query(`
      CREATE INDEX "EmailVerificationToken_expiresAt_idx"
        ON "EmailVerificationToken" ("expiresAt")
    `);

    await queryRunner.query(`
      ALTER TABLE "EmailVerificationToken"
        ADD CONSTRAINT "FK_EmailVerificationToken_utilisateur"
        FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EmailVerificationToken" DROP CONSTRAINT "FK_EmailVerificationToken_utilisateur"`,
    );
    await queryRunner.query(`DROP INDEX "EmailVerificationToken_expiresAt_idx"`);
    await queryRunner.query(`DROP INDEX "EmailVerificationToken_email_idx"`);
    await queryRunner.query(
      `DROP INDEX "EmailVerificationToken_tokenHash_key"`,
    );
    await queryRunner.query(`DROP TABLE "EmailVerificationToken"`);
    await queryRunner.query(
      `ALTER TABLE "Utilisateur" DROP COLUMN "emailVerifieA"`,
    );
    await queryRunner.query(`ALTER TABLE "Utilisateur" DROP COLUMN "estVerifie"`);
  }
}
