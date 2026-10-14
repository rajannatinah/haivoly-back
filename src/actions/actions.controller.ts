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
import { IsOptional, IsString, MaxLength } from 'class-validator';

class ActionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  actionType?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  syncStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
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
      // Le périmètre est résolu côté service à partir de l'auteur : un
      // propriétaire voit les actions de ses agriculteurs, un agriculteur
      // uniquement les siennes.
      demandeurId: user.id,
      estProprietaire,
      userId: estProprietaire ? query.userId : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.actionsService.findOne(id, user);
  }
}
