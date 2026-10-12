import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { SynchronizationService } from './synchronization.service';
import { SyncDto, BatchSyncDto } from '../actions/dto/batch-sync.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('sync')
export class SynchronizationController {
  constructor(
    private readonly synchronizationService: SynchronizationService,
  ) {}

  /** Traitement d'une file d'actions : 200 (aucune ressource créée). */
  @Post()
  @HttpCode(HttpStatus.OK)
  synchronize(@Body() dto: SyncDto, @CurrentUser() user: AuthenticatedUser) {
    return this.synchronizationService.synchronize(user.id, dto);
  }
}

@Controller('actions')
export class ActionsSyncAliasController {
  constructor(
    private readonly synchronizationService: SynchronizationService,
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Body() dto: SyncDto, @CurrentUser() user: AuthenticatedUser) {
    return this.synchronizationService.synchronize(user.id, dto);
  }

  @Post('batch-sync')
  @HttpCode(HttpStatus.OK)
  batchSync(@Body() dto: BatchSyncDto, @CurrentUser() user: AuthenticatedUser) {
    return this.synchronizationService.synchronize(user.id, dto);
  }
}
