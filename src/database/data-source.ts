import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Doit précéder toute création de connexion (lecture UTC des dates).
import './pg-types';
import { DataSource, DataSourceOptions } from 'typeorm';

import { Utilisateur } from '../users/entities/utilisateur.entity';
import { Parcelle } from '../parcelles/entities/parcelle.entity';
import { PointGPS } from '../points-gps/entities/point-gps.entity';
import { Culture } from '../cultures/entities/culture.entity';
import { PointGPSCulture } from '../cultures/entities/point-gps-culture.entity';
import { Intervention } from '../interventions/entities/intervention.entity';
import { Observation } from '../observations/entities/observation.entity';
import { Photo } from '../photos/entities/photo.entity';
import { PhotoIntervention } from '../photos-interventions/entities/photo-intervention.entity';
import { Recolte } from '../recoltes/entities/recolte.entity';
import { PhotoRecolte } from '../photos-recoltes/entities/photo-recolte.entity';
import { Action } from '../actions/entities/action.entity';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { EmailVerificationToken } from '../auth/entities/email-verification-token.entity';

function loadEnvFile(): void {
  loadEnv();

  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadEnv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnvFile();

export const entities = [
  Utilisateur,
  Parcelle,
  PointGPS,
  Culture,
  PointGPSCulture,
  Intervention,
  Observation,
  Photo,
  PhotoIntervention,
  Recolte,
  PhotoRecolte,
  Action,
  Recommendation,
  PasswordResetToken,
  EmailVerificationToken,
];

export function buildDataSourceOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL n'est pas définie");
  }

  return {
    type: 'postgres',
    url: databaseUrl,
    entities,
    migrations: [`${__dirname}/migrations/*{.ts,.js}`],
    synchronize: false,
    migrationsRun: false,
    logging: env.TYPEORM_LOGGING === 'true' ? ['query', 'error'] : ['error'],
    ssl:
      env.DATABASE_SSL === 'true'
        ? {
            rejectUnauthorized:
              env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
          }
        : false,
    extra: {
      max: Number(env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
    },
  };
}

/** DataSource utilisé par la CLI (`npm run migration:run`, `migration:generate`). */
export const AppDataSource = new DataSource(buildDataSourceOptions());
