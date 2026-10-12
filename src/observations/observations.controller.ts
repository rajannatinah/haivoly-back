import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { ObservationsService } from './observations.service';
import {
  CreateObservationDto,
  UpdateObservationDto,
} from './dto/observation.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller()
export class ObservationsController {
  constructor(private readonly observationsService: ObservationsService) {}

  // ── Routes imbriquées historiques ──────────────────────────

  @Post('parcelles/:parcelleId/cultures/:cultureId/observations')
  createNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Body() dto: CreateObservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.create(cultureId, dto, user.id, parcelleId);
  }

  @Get('parcelles/:parcelleId/cultures/:cultureId/observations')
  findAllNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.findAll(cultureId, user.id, parcelleId);
  }

  @Get('parcelles/:parcelleId/cultures/:cultureId/observations/:id')
  findOneNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.findOne(cultureId, id, user.id, parcelleId);
  }

  @Patch('parcelles/:parcelleId/cultures/:cultureId/observations/:id')
  updateNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @Body() dto: UpdateObservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.update(
      cultureId,
      id,
      dto,
      user.id,
      parcelleId,
    );
  }

  @Delete('parcelles/:parcelleId/cultures/:cultureId/observations/:id')
  removeNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.remove(cultureId, id, user.id, parcelleId);
  }

  // ── Routes courtes (mobile) ────────────────────────────────

  @Post('cultures/:cultureId/observations')
  create(
    @Param('cultureId') cultureId: string,
    @Body() dto: CreateObservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.create(cultureId, dto, user.id);
  }

  @Get('cultures/:cultureId/observations')
  findAll(
    @Param('cultureId') cultureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.findAll(cultureId, user.id);
  }

  @Get('cultures/:cultureId/observations/:id')
  findOne(
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.findOne(cultureId, id, user.id);
  }

  @Patch('cultures/:cultureId/observations/:id')
  update(
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @Body() dto: UpdateObservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.update(cultureId, id, dto, user.id);
  }


  @Get('observations/:id')
  findOneFlat(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.observationsService.findOneById(id, user.id);
  }

  @Patch('observations/:id')
  updateFlat(
    @Param('id') id: string,
    @Body() dto: UpdateObservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.updateById(id, dto, user.id);
  }

  @Delete('observations/:id')
  removeFlat(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.observationsService.removeById(id, user.id);
  }

  @Delete('cultures/:cultureId/observations/:id')
  remove(
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.observationsService.remove(cultureId, id, user.id);
  }
}
