import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ParcellesService } from './parcelles.service';
import { CreateParcelleDto } from './dto/creation-parcelle.dto';
import { UpdateParcelleDto } from './dto/modification-parcelle.dto';
import {
  AjouterPointsGPSDto,
  ModifierDelimitationDto,
  SupprimerParcelleDto,
} from './dto/delimitation.dto';

import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { StatutParcelle } from '../common/enums/domain.enums';
import { IsEnum, IsOptional } from 'class-validator';

class ListeParcellesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StatutParcelle)
  statut?: StatutParcelle;
}

@Controller('parcelles')
export class ParcellesController {
  constructor(private readonly parcellesService: ParcellesService) {}

  @Post()
  create(
    @Body() dto: CreateParcelleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcellesService.create(dto, user.id);
  }

  @Get()
  findAll(
    @Query() query: ListeParcellesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcellesService.findAll(
      user.id,
      query.page,
      query.limit ?? 50,
      query.statut,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.parcellesService.findOne(id, user.id);
  }

  @Post(':id/points-gps')
  addPointsGPS(
    @Param('id') id: string,
    @Body() dto: AjouterPointsGPSDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcellesService.addPointsGPS(id, dto.pointsGPS, user.id);
  }

  @Put(':id/delimitation')
  updateDelimitation(
    @Param('id') id: string,
    @Body() dto: ModifierDelimitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcellesService.updateDelimitation(id, dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateParcelleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcellesService.update(id, dto, user.id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body() dto: SupprimerParcelleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcellesService.remove(id, dto.raison, user.id);
  }
}
