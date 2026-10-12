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

import { RecoltesService } from './recoltes.service';
import { CreateRecolteDto, UpdateRecolteDto } from './dto/recolte.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

@Controller()
export class RecoltesController {
  constructor(private readonly recoltesService: RecoltesService) {}

  @Get('recoltes')
  findAll(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recoltesService.findAll(user.id, query.page, query.limit ?? 50);
  }

  @Post('cultures/:cultureId/recolte')
  create(
    @Param('cultureId') cultureId: string,
    @Body() dto: CreateRecolteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recoltesService.create(cultureId, dto, user.id);
  }

  @Get('cultures/:cultureId/recolte')
  findOne(
    @Param('cultureId') cultureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recoltesService.findOne(cultureId, user.id);
  }

  @Patch('recoltes/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecolteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recoltesService.update(id, dto, user.id);
  }

  @Delete('recoltes/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recoltesService.remove(id, user.id);
  }
}
