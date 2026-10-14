import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Utilisateur } from './entities/utilisateur.entity';
import { AuthModule } from '../auth/auth.module';
import { UsernameModule } from './username.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Utilisateur]),
    AuthModule,
    UsernameModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
