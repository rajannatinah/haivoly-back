import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsernameService } from './username.service';
import { Utilisateur } from './entities/utilisateur.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Utilisateur])],
  providers: [UsernameService],
  exports: [UsernameService],
})
export class UsernameModule {}
