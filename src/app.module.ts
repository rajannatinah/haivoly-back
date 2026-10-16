import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ParcellesModule } from './parcelles/parcelles.module';
import { CulturesModule } from './cultures/cultures.module';
import { InterventionsModule } from './interventions/interventions.module';
import { ObservationsModule } from './observations/observations.module';
import { RecoltesModule } from './recoltes/recoltes.module';
import { PhotosModule } from './photos/photos.module';
import { PhotosInterventionsModule } from './photos-interventions/photos-interventions.module';
import { PhotosRecoltesModule } from './photos-recoltes/photos-recoltes.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { MailModule } from './mail/mail.module';
import { UsernameModule } from './users/username.module';
import { ActionsModule } from './actions/actions.module';
import { ActiviteModule } from './activite/activite.module';
import { SynchronizationModule } from './synchronization/synchronization.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { RolesGuard } from './auth/guards/roles.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 300 }],
      }),
    }),

    // Domaines
    AuthModule,
    UsersModule,
    MailModule,
    UsernameModule,
    ParcellesModule,
    CulturesModule,
    InterventionsModule,
    ObservationsModule,
    RecoltesModule,
    PhotosModule,
    PhotosInterventionsModule,
    PhotosRecoltesModule,
    RecommendationsModule,
    ActionsModule,
    // Activité en ligne : journal + notification du propriétaire (B-16).
    ActiviteModule,
    SynchronizationModule,
    DashboardModule,

    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Ordre impératif : l'authentification doit renseigner `request.user`
    // AVANT que le RolesGuard ne lise le rôle.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
