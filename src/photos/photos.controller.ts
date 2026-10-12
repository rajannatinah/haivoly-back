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

import { PhotosService } from './photos.service';
import { CreatePhotoDto, UpdatePhotoDto } from './dto/photo.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { imageUploadOptions } from '../common/utils/upload.util';

interface UploadedImage {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

const uploadOptions = imageUploadOptions('observations', 'observation');

@Controller()
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  // ── Routes imbriquées historiques ──────────────────────────

  @Post(
    'parcelles/:parcelleId/cultures/:cultureId/observations/:observationId/photos',
  )
  createNested(
    @Param('cultureId') cultureId: string,
    @Param('observationId') observationId: string,
    @Body() dto: CreatePhotoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.create(observationId, cultureId, dto, user.id);
  }

  @Post(
    'parcelles/:parcelleId/cultures/:cultureId/observations/:observationId/photos/upload',
  )
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  uploadNested(
    @Param('cultureId') cultureId: string,
    @Param('observationId') observationId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Aucune image n’a été envoyée');
    }
    return this.photosService.upload(
      observationId,
      cultureId,
      user.id,
      `/uploads/observations/${file.filename}`,
    );
  }

  @Get(
    'parcelles/:parcelleId/cultures/:cultureId/observations/:observationId/photos',
  )
  findAllNested(
    @Param('cultureId') cultureId: string,
    @Param('observationId') observationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.findAll(observationId, cultureId, user.id);
  }

  @Get(
    'parcelles/:parcelleId/cultures/:cultureId/observations/:observationId/photos/:id',
  )
  findOneNested(
    @Param('cultureId') cultureId: string,
    @Param('observationId') observationId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.findOne(observationId, cultureId, id, user.id);
  }

  @Patch(
    'parcelles/:parcelleId/cultures/:cultureId/observations/:observationId/photos/:id',
  )
  updateNested(
    @Param('cultureId') cultureId: string,
    @Param('observationId') observationId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePhotoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.update(
      observationId,
      cultureId,
      id,
      dto,
      user.id,
    );
  }

  @Delete(
    'parcelles/:parcelleId/cultures/:cultureId/observations/:observationId/photos/:id',
  )
  removeNested(
    @Param('cultureId') cultureId: string,
    @Param('observationId') observationId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.remove(observationId, cultureId, id, user.id);
  }

  // ── Routes courtes (mobile) ────────────────────────────────

  @Post('observations/:observationId/photos')
  create(
    @Param('observationId') observationId: string,
    @Body() dto: CreatePhotoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.create(observationId, '', dto, user.id);
  }

  @Post('observations/:observationId/photos/upload')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  upload(
    @Param('observationId') observationId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Aucune image n’a été envoyée');
    }
    return this.photosService.upload(
      observationId,
      '',
      user.id,
      `/uploads/observations/${file.filename}`,
    );
  }

  @Get('observations/:observationId/photos')
  findAll(
    @Param('observationId') observationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.findAll(observationId, '', user.id);
  }

  @Get('observations/:observationId/photos/:id')
  findOne(
    @Param('observationId') observationId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.findOne(observationId, '', id, user.id);
  }

  @Delete('observations/:observationId/photos/:id')
  remove(
    @Param('observationId') observationId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosService.remove(observationId, '', id, user.id);
  }
}
