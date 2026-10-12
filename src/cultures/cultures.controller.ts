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
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, ValidateNested } from 'class-validator';

import { CulturesService } from './cultures.service';
import { CreateCultureDto } from './dto/creation-culture.dto';
import { UpdateCultureDto } from './dto/modification-culture.dto';
import { PointGPSCultureInputDto } from './dto/creation-culture.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { StatutCulture } from '../common/enums/domain.enums';

class PointsGPSCultureDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointGPSCultureInputDto)
  points: PointGPSCultureInputDto[];
}

class DeleteCultureDto {
  @IsOptional()
  raison?: string;
}

class ListeCulturesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StatutCulture)
  statut?: StatutCulture;
}

@Controller()
export class CulturesController {
  constructor(private readonly culturesService: CulturesService) {}

  @Get('cultures')
  findAllForUser(
    @Query() query: ListeCulturesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.findAllForUser(
      user.id,
      query.page,
      query.limit ?? 50,
      query.statut,
    );
  }

  @Post('parcelles/:parcelleId/cultures')
  create(
    @Param('parcelleId') parcelleId: string,
    @Body() dto: CreateCultureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.create(parcelleId, dto, user.id);
  }

  @Get('parcelles/:parcelleId/cultures')
  findAll(
    @Param('parcelleId') parcelleId: string,
    @Query() query: ListeCulturesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.findAll(
      parcelleId,
      user.id,
      query.page,
      query.limit ?? 50,
    );
  }

  @Get('parcelles/:parcelleId/cultures/:id')
  findOne(
    @Param('parcelleId') parcelleId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.findOne(parcelleId, id, user.id);
  }

  /** Route plate (mobile) : la parcelle n'est pas nécessaire dans l'URL. */
  @Get('cultures/:id')
  findOneFlat(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.culturesService.findOne(undefined, id, user.id);
  }

  @Patch('parcelles/:parcelleId/cultures/:id')
  update(
    @Param('parcelleId') parcelleId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCultureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.update(parcelleId, id, dto, user.id);
  }

  @Delete('parcelles/:parcelleId/cultures/:id')
  remove(
    @Param('parcelleId') parcelleId: string,
    @Param('id') id: string,
    @Body() dto: DeleteCultureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.remove(parcelleId, id, user.id, dto?.raison);
  }

  @Get('parcelles/:parcelleId/cultures/:id/points-gps')
  findPointsGPS(
    @Param('parcelleId') parcelleId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.findPointsGPS(parcelleId, id, user.id);
  }

  @Post('parcelles/:parcelleId/cultures/:id/points-gps')
  savePointsGPS(
    @Param('parcelleId') parcelleId: string,
    @Param('id') id: string,
    @Body() dto: PointsGPSCultureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.culturesService.savePointsGPS(
      parcelleId,
      id,
      user.id,
      dto.points,
    );
  }
}
