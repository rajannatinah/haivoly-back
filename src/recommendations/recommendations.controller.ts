import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { RecommendationsService } from './recommendations.service';
import {
  CreateRecommendationDto,
  RecommendationQueryDto,
} from './dto/recommendation.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  /** Publication d'une recommandation : réservée au propriétaire. */
  @Post()
  @Roles(Role.PROPRIETAIRE)
  create(@Body() dto: CreateRecommendationDto) {
    return this.recommendationsService.create(dto);
  }

  /** Recommandations de l'utilisateur connecté. */
  @Get('me')
  forMe(
    @CurrentUser() user: AuthenticatedUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.recommendationsService.findForUser(
      user.id,
      unreadOnly === 'true',
      includeExpired === 'true',
    );
  }

  @Get('me/unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.unreadCount(user.id);
  }

  /** Vue de pilotage (toutes les recommandations) : propriétaire. */
  @Get()
  @Roles(Role.PROPRIETAIRE)
  findAll(@Query() query: RecommendationQueryDto) {
    return this.recommendationsService.findAll(query);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.markAllReadForUser(user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.markRead(id, user.id);
  }

  @Patch(':id/unread')
  markUnread(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.markUnread(id, user.id);
  }

  /** Suppression : le destinataire ou le propriétaire. */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.remove(id, user);
  }
}
