import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { InterventionsService } from './interventions.service';
import {
  CreateInterventionDto,
  UpdateInterventionDto,
} from './dto/intervention.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller()
export class InterventionsController {
  constructor(private readonly interventionsService: InterventionsService) {}

  @Post('parcelles/:parcelleId/cultures/:cultureId/interventions')
  createNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Body() dto: CreateInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.create(
      cultureId,
      dto,
      user.id,
      parcelleId,
    );
  }

  @Get('parcelles/:parcelleId/cultures/:cultureId/interventions')
  findAllNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.findAll(cultureId, user.id, parcelleId);
  }

  @Get('parcelles/:parcelleId/cultures/:cultureId/interventions/:id')
  findOneNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.findOne(
      cultureId,
      id,
      user.id,
      parcelleId,
    );
  }

  @Patch('parcelles/:parcelleId/cultures/:cultureId/interventions/:id')
  updateNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.update(
      cultureId,
      id,
      dto,
      user.id,
      parcelleId,
    );
  }

  @Delete('parcelles/:parcelleId/cultures/:cultureId/interventions/:id')
  removeNested(
    @Param('parcelleId') parcelleId: string,
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.remove(cultureId, id, user.id, parcelleId);
  }

  // ── Routes courtes (mobile) ────────────────────────────────

  @Post('cultures/:cultureId/interventions')
  create(
    @Param('cultureId') cultureId: string,
    @Body() dto: CreateInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.create(cultureId, dto, user.id);
  }

  @Get('cultures/:cultureId/interventions')
  findAll(
    @Param('cultureId') cultureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.findAll(cultureId, user.id);
  }

  @Get('cultures/:cultureId/interventions/:id')
  findOne(
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.findOne(cultureId, id, user.id);
  }

  @Patch('cultures/:cultureId/interventions/:id')
  update(
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.update(cultureId, id, dto, user.id);
  }

  @Delete('cultures/:cultureId/interventions/:id')
  remove(
    @Param('cultureId') cultureId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.remove(cultureId, id, user.id);
  }


  @Get('interventions/:id')
  findOneFlat(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interventionsService.findOneById(id, user.id);
  }

  @Patch('interventions/:id')
  updateFlat(
    @Param('id') id: string,
    @Body() dto: UpdateInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interventionsService.updateById(id, dto, user.id);
  }

  @Delete('interventions/:id')
  removeFlat(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.interventionsService.removeById(id, user.id);
  }
}
