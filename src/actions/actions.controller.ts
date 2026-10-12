import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { ActionsService } from './actions.service';
import { CreateActionDto } from './dto/create-action.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

class ActionQueryDto extends PaginationQueryDto {
  userId?: string;
  actionType?: string;
  entityType?: string;
  syncStatus?: string;
  q?: string;
  search?: string;
}

@Controller('actions')
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Post()
  create(@Body() dto: CreateActionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.actionsService.create(user.id, dto);
  }

  /** Statistiques globales de la plateforme : réservées au propriétaire. */
  @Get('stats/dashboard')
  @Roles(Role.PROPRIETAIRE)
  stats() {
    return this.actionsService.stats();
  }

  @Get('me/failed')
  failed(@CurrentUser() user: AuthenticatedUser) {
    return this.actionsService.failedForUser(user.id);
  }

  @Get()
  findAll(
    @Query() query: ActionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const estProprietaire = user.role === Role.PROPRIETAIRE;

    return this.actionsService.findAll({
      ...query,
      search: query.q ?? query.search,
      userId: estProprietaire ? query.userId : user.id,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.actionsService.findOne(id, user);
  }
}
