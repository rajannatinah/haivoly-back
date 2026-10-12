import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { InterventionsController } from './interventions.controller';
import { InterventionsService } from './interventions.service';
import { Intervention } from './entities/intervention.entity';
import { Culture } from '../cultures/entities/culture.entity';
import { PhotoIntervention } from '../photos-interventions/entities/photo-intervention.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Intervention, Culture, PhotoIntervention]),
    UsersModule,
  ],
  controllers: [InterventionsController],
  providers: [InterventionsService],
  exports: [InterventionsService],
})
export class InterventionsModule {}
