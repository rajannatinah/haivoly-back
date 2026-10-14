import { MigrationInterface, QueryRunner } from 'typeorm';

const LONGUEUR_MAX = 30;
const LONGUEUR_MIN = 3;
const CONTRAINTE_FORMAT = '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$';

const SQL_CONTRAINTE_FORMAT = `CHECK ("username" ~ '${CONTRAINTE_FORMAT}'
    AND char_length("username") BETWEEN ${LONGUEUR_MIN} AND ${LONGUEUR_MAX})`;

/** Étape 2 : base normalisée, déterministe, longueur bornée. */
const SQL_BACKFILL = `
  WITH bruts AS (
    SELECT
      "id" AS id,
      "creeA" AS cree_a,
      left(
        regexp_replace(
          lower(
            coalesce(
              nullif(trim("prenom"), ''),
              nullif(trim("nom"), ''),
              'utilisateur'
            )
          ),
          '[^a-z0-9]', '', 'g'
        ),
        ${LONGUEUR_MAX}
      ) AS base
    FROM "Utilisateur"
    WHERE "username" IS NULL OR btrim("username") = ''
  ),
  normalises AS (
    SELECT
      id,
      cree_a,
      CASE
        WHEN char_length(base) >= ${LONGUEUR_MIN} THEN base
        ELSE left(base || substr(md5(id::text), 1, 4), ${LONGUEUR_MAX})
      END AS base
    FROM bruts
  ),
  rangees AS (
    SELECT
      id,
      base,
      row_number() OVER (
        PARTITION BY base ORDER BY cree_a ASC NULLS LAST, id ASC
      ) AS rang
    FROM normalises
  ),
  proposes AS (
    SELECT
      id,
      CASE
        WHEN rang = 1 THEN base
        ELSE left(base, ${LONGUEUR_MAX} - char_length(rang::text)) || rang::text
      END AS username
    FROM rangees
  )
  UPDATE "Utilisateur" AS u
  SET "username" = p.username
  FROM proposes AS p
  WHERE u."id" = p.id
`;

/** Étape 3 : les doublons résiduels (troncature + suffixe) sont séparés par empreinte d'identifiant. */
const SQL_DOUBLONS = `
  WITH doublons AS (
    SELECT "username"
    FROM "Utilisateur"
    WHERE "username" IS NOT NULL
    GROUP BY "username"
    HAVING count(*) > 1
  ),
  nouveaux AS (
    SELECT
      u."id" AS id,
      left(u."username", ${LONGUEUR_MAX - 7}) || '-' || substr(md5(u."id"::text), 1, 6) AS username
    FROM "Utilisateur" AS u
    JOIN doublons AS d ON d."username" = u."username"
  )
  UPDATE "Utilisateur" AS u
  SET "username" = left(n.username, ${LONGUEUR_MAX})
  FROM nouveaux AS n
  WHERE u."id" = n.id
`;

const SQL_CONTROLE = `
  DO $$
  DECLARE
    nb_nuls integer;
    nb_doublons integer;
    nb_non_conformes integer;
  BEGIN
    SELECT count(*) INTO nb_nuls
      FROM "Utilisateur"
      WHERE "username" IS NULL OR btrim("username") = '';

    IF nb_nuls > 0 THEN
      RAISE EXCEPTION
        'Migration username interrompue : % compte(s) sans nom d’utilisateur.', nb_nuls;
    END IF;

    SELECT count(*) INTO nb_doublons FROM (
      SELECT "username" FROM "Utilisateur"
      GROUP BY "username" HAVING count(*) > 1
    ) AS d;

    IF nb_doublons > 0 THEN
      RAISE EXCEPTION
        'Migration username interrompue : % nom(s) d’utilisateur en doublon.', nb_doublons;
    END IF;

    SELECT count(*) INTO nb_non_conformes
      FROM "Utilisateur"
      WHERE "username" !~ '${CONTRAINTE_FORMAT}'
         OR char_length("username") < 3
         OR char_length("username") > ${LONGUEUR_MAX};

    IF nb_non_conformes > 0 THEN
      RAISE EXCEPTION
        'Migration username interrompue : % nom(s) non conformes à la convention.',
        nb_non_conformes;
    END IF;
  END
  $$
`;

/** Étape 6 : relations toujours intactes — on le vérifie, sans les modifier. */
const SQL_RELATIONS = `
  DO $$
  DECLARE
    nb_parcelles bigint;
    nb_orphelines bigint;
  BEGIN
    SELECT count(*) INTO nb_parcelles FROM "Parcelle";

    SELECT count(*) INTO nb_orphelines
      FROM "Parcelle" p
      WHERE p."utilisateurId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Utilisateur" u WHERE u."id" = p."utilisateurId");

    IF nb_orphelines > 0 THEN
      RAISE EXCEPTION
        'Intégrité des données en doute : % parcelle(s) sans utilisateur valide après migration.',
        nb_orphelines;
    END IF;
  END
  $$
`;

export class UsernameUtilisateur1800000000000 implements MigrationInterface {
  name = 'UsernameUtilisateur1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Colonnes ajoutées NULLABLE / avec défaut : jamais de perte de données.
    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD COLUMN IF NOT EXISTS "username" varchar(${LONGUEUR_MAX})
    `);

    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD COLUMN IF NOT EXISTS "motDePasseProvisoire" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD COLUMN IF NOT EXISTS "langue" varchar(5)
    `);

    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        DROP CONSTRAINT IF EXISTS "CK_Utilisateur_langue"
    `);
    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD CONSTRAINT "CK_Utilisateur_langue"
        CHECK ("langue" IS NULL OR "langue" IN ('fr', 'en', 'mg'))
    `);

    // 2 + 3. Backfill déterministe puis résolution des collisions.
    await queryRunner.query(SQL_BACKFILL);
    await queryRunner.query(SQL_DOUBLONS);

    // 4. Unicité vérifiée AVANT de rendre le champ obligatoire.
    await queryRunner.query(SQL_CONTROLE);

    // 5. Contraintes et index.
    await queryRunner.query(`
      ALTER TABLE "Utilisateur" ALTER COLUMN "username" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_Utilisateur_username"
        ON "Utilisateur" ("username")
    `);

    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        DROP CONSTRAINT IF EXISTS "CK_Utilisateur_username_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "Utilisateur"
        ADD CONSTRAINT "CK_Utilisateur_username_format"
        ${SQL_CONTRAINTE_FORMAT}
    `);

    // 7. Intégrité fonctionnelle : les dépendances métier sont contrôlées.
    await queryRunner.query(SQL_RELATIONS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Utilisateur" DROP CONSTRAINT IF EXISTS "CK_Utilisateur_username_format"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_Utilisateur_username"`);
    await queryRunner.query(`
      ALTER TABLE "Utilisateur" DROP COLUMN IF EXISTS "username"
    `);
    await queryRunner.query(`
      ALTER TABLE "Utilisateur" DROP COLUMN IF EXISTS "motDePasseProvisoire"
    `);
    await queryRunner.query(`
      ALTER TABLE "Utilisateur" DROP CONSTRAINT IF EXISTS "CK_Utilisateur_langue"
    `);
    await queryRunner.query(`
      ALTER TABLE "Utilisateur" DROP COLUMN IF EXISTS "langue"
    `);
  }
}

/** Exposés pour les tests unitaires : la migration et la convention ne peuvent pas diverger. */
export const SQL_MIGRATION_USERNAME = {
  backfill: SQL_BACKFILL,
  doublons: SQL_DOUBLONS,
  controle: SQL_CONTROLE,
  relations: SQL_RELATIONS,
  contrainteFormat: CONTRAINTE_FORMAT,
  contrainte: SQL_CONTRAINTE_FORMAT,
  longueurMin: LONGUEUR_MIN,
  longueurMax: LONGUEUR_MAX,
};
