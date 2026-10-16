import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Action } from '../actions/entities/action.entity';
import { ActionsModule } from '../actions/actions.module';
import { ActiviteEnLigneInterceptor } from './activite-en-ligne.interceptor';
import { ActiviteService } from './activite.service';

/**
 * Activité terrain en ligne (B-16) : un intercepteur global, un service.
 * Chaque action mobile notifie le propriétaire, en ligne comme hors ligne.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Action]), ActionsModule],
  providers: [
    ActiviteService,
    { provide: APP_INTERCEPTOR, useClass: ActiviteEnLigneInterceptor },
  ],
  exports: [ActiviteService],
})
export class ActiviteModule {}
