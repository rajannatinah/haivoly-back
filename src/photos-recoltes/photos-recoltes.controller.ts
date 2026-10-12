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

import { PhotosRecoltesService } from './photos-recoltes.service';
import {
  CreatePhotoRecolteDto,
  UpdatePhotoRecolteDto,
} from './dto/photo-recolte.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { imageUploadOptions } from '../common/utils/upload.util';

interface UploadedImage {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

const uploadOptions = imageUploadOptions('recoltes', 'recolte');

@Controller('recoltes/:recolteId/photos')
export class PhotosRecoltesController {
  constructor(private readonly photosRecoltesService: PhotosRecoltesService) {}

  @Post()
  create(
    @Param('recolteId') recolteId: string,
    @Body() dto: CreatePhotoRecolteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosRecoltesService.create(recolteId, dto, user.id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  upload(
    @Param('recolteId') recolteId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Aucune image n’a été envoyée');
    }
    return this.photosRecoltesService.upload(
      recolteId,
      user.id,
      `/uploads/recoltes/${file.filename}`,
    );
  }

  @Get()
  findAll(
    @Param('recolteId') recolteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosRecoltesService.findAll(recolteId, user.id);
  }

  @Get(':id')
  findOne(
    @Param('recolteId') recolteId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosRecoltesService.findOne(recolteId, id, user.id);
  }

  @Patch(':id')
  update(
    @Param('recolteId') recolteId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePhotoRecolteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosRecoltesService.update(recolteId, id, dto, user.id);
  }

  @Delete(':id')
  remove(
    @Param('recolteId') recolteId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.photosRecoltesService.remove(recolteId, id, user.id);
  }
}
