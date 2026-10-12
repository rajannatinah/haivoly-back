import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const synchronize = config.get<string>('DB_SYNCHRONIZE') === 'true';
        const environment = config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
        if (environment === 'production' && synchronize) {
          throw new Error(
            'Configuration de base de données invalide : DB_SYNCHRONIZE ne peut jamais être activé en production; exécutez les migrations TypeORM.',
          );
        }

        const options = buildDataSourceOptions({
          ...process.env,
          DATABASE_URL:
            config.get<string>('DATABASE_URL') ?? process.env.DATABASE_URL,
          DATABASE_SSL: config.get<string>('DATABASE_SSL'),
          DATABASE_POOL_MAX: config.get<string>('DATABASE_POOL_MAX'),
          TYPEORM_LOGGING: config.get<string>('TYPEORM_LOGGING'),
        });

        return {
          ...options,
          // `false` en production : le schéma est piloté par les migrations.
          // Le contrôle ci-dessus interdit explicitement l'option en production.
          synchronize,
        };
      },
      dataSourceFactory: async (options) => {
        const dataSource = new DataSource(options!);
        return dataSource.initialize();
      },
    }),
  ],
})
export class DatabaseModule {}
