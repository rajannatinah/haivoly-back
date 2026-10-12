import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { ObservationsController } from './observations.controller';
import { ObservationsService } from './observations.service';
import { Observation } from './entities/observation.entity';
import { Culture } from '../cultures/entities/culture.entity';
import { Photo } from '../photos/entities/photo.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Observation, Culture, Photo]), UsersModule],
  controllers: [ObservationsController],
  providers: [ObservationsService],
  exports: [ObservationsService],
})
export class ObservationsModule {}
