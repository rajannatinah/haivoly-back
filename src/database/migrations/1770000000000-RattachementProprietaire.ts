import { MigrationInterface, QueryRunner } from 'typeorm';

export class RattachementProprietaire1770000000000 implements MigrationInterface {
  name = 'RattachementProprietaire1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD COLUMN "proprietaireId" text
    `);

    // Un utilisateur ne peut pas etre son propre proprietaire.
    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD CONSTRAINT "CK_Utilisateur_pas_auto_rattachement"
        CHECK ("proprietaireId" IS NULL OR "proprietaireId" <> "id")
    `);

    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD CONSTRAINT "FK_Utilisateur_proprietaire"
        FOREIGN KEY ("proprietaireId") REFERENCES "Utilisateur"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "Utilisateur_proprietaireId_idx"
        ON "Utilisateur" ("proprietaireId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "Utilisateur_proprietaireId_idx"`);
    await queryRunner.query(
      `ALTER TABLE "Utilisateur" DROP CONSTRAINT "FK_Utilisateur_proprietaire"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Utilisateur" DROP CONSTRAINT "CK_Utilisateur_pas_auto_rattachement"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Utilisateur" DROP COLUMN "proprietaireId"`,
    );
  }
}
