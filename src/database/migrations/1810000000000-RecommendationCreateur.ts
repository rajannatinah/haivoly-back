import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lot 9 (web) : l'émetteur d'une recommandation devient une donnée persistée.
 *
 * Jusqu'ici seule la relation destinataire (`userId`) était stockée : la vue
 * web « Envoyées » était donc impossible sans deviner. La colonne est nullable
 * — les recommandations antérieures au patch restent lisibles, avec un
 * émetteur inconnu affiché tel quel (« — »), jamais inventé.
 */
export class RecommendationCreateur1810000000000
  implements MigrationInterface
{
  name = 'RecommendationCreateur1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Recommendation"
        ADD COLUMN IF NOT EXISTS "createdById" text
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "Recommendation_createdById_idx"
        ON "Recommendation" ("createdById")
    `);

    await queryRunner.query(`
      ALTER TABLE "Recommendation"
        ADD CONSTRAINT "FK_Recommendation_createur"
        FOREIGN KEY ("createdById") REFERENCES "Utilisateur"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Recommendation"
        DROP CONSTRAINT IF EXISTS "FK_Recommendation_createur"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "Recommendation_createdById_idx"`,
    );
    await queryRunner.query(`
      ALTER TABLE "Recommendation"
        DROP COLUMN IF EXISTS "createdById"
    `);
  }
}
