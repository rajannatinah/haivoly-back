import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { PhotosInterventionsService } from './photos-interventions.service';
import {
  CreatePhotoInterventionDto,
  UpdatePhotoInterventionDto,
} from './dto/photo-intervention.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { imageUploadOptions } from '../common/utils/upload.util';

interface UploadedImage {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

const uploadOptions = imageUploadOptions('interventions', 'intervention');

@Controller()
export class PhotosInterventionsController {
  constructor(
    private readonly photosInterventionsService: PhotosInterventionsService,
  ) {}

  // ── Routes imbriquées historiques ──────────────────────────

  @Post(
    'parcelles/:parcelleId/cultures/:cultureId/interventions/:interventionId/photos',
  )
  createNested(
    @Param('cultureId') cultureId: string,
    @Param('interventionId') interventionId: string,
    @Body() dto: CreatePhotoInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.create(
      interventionId,
      cultureId,
      dto,
      user.id,
    );
  }

  @Post(
    'parcelles/:parcelleId/cultures/:cultureId/interventions/:interventionId/photos/upload',
  )
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  uploadNested(
    @Param('cultureId') cultureId: string,
    @Param('interventionId') interventionId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Aucune image n’a été envoyée');
    }
    return this.photosInterventionsService.upload(
      interventionId,
      cultureId,
      user.id,
      `/uploads/interventions/${file.filename}`,
    );
  }

  @Get(
    'parcelles/:parcelleId/cultures/:cultureId/interventions/:interventionId/photos',
  )
  findAllNested(
    @Param('cultureId') cultureId: string,
    @Param('interventionId') interventionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.findAll(
      interventionId,
      cultureId,
      user.id,
    );
  }

  @Get(
    'parcelles/:parcelleId/cultures/:cultureId/interventions/:interventionId/photos/:id',
  )
  findOneNested(
    @Param('cultureId') cultureId: string,
    @Param('interventionId') interventionId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.findOne(
      interventionId,
      cultureId,
      id,
      user.id,
    );
  }

  @Patch(
    'parcelles/:parcelleId/cultures/:cultureId/interventions/:interventionId/photos/:id',
  )
  updateNested(
    @Param('cultureId') cultureId: string,
    @Param('interventionId') interventionId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePhotoInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.update(
      interventionId,
      cultureId,
      id,
      dto,
      user.id,
    );
  }

  @Delete(
    'parcelles/:parcelleId/cultures/:cultureId/interventions/:interventionId/photos/:id',
  )
  removeNested(
    @Param('cultureId') cultureId: string,
    @Param('interventionId') interventionId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.remove(
      interventionId,
      cultureId,
      id,
      user.id,
    );
  }

  // ── Routes courtes (mobile) ────────────────────────────────

  @Post('interventions/:interventionId/photos')
  create(
    @Param('interventionId') interventionId: string,
    @Body() dto: CreatePhotoInterventionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.create(
      interventionId,
      '',
      dto,
      user.id,
    );
  }

  @Post('interventions/:interventionId/photos/upload')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  upload(
    @Param('interventionId') interventionId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Aucune image n’a été envoyée');
    }
    return this.photosInterventionsService.upload(
      interventionId,
      '',
      user.id,
      `/uploads/interventions/${file.filename}`,
    );
  }

  @Get('interventions/:interventionId/photos')
  findAll(
    @Param('interventionId') interventionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.findAll(interventionId, '', user.id);
  }

  @Delete('interventions/:interventionId/photos/:id')
  remove(
    @Param('interventionId') interventionId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosInterventionsService.remove(
      interventionId,
      '',
      id,
      user.id,
    );
  }
}
