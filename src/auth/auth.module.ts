import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Utilisateur,
      PasswordResetToken,
      EmailVerificationToken,
    ]),
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        const production = config.get<string>('NODE_ENV') === 'production';
        if (production && (!secret || secret === 'change-me')) {
          throw new Error(
            'Configuration d’authentification invalide : JWT_SECRET doit être un secret fort en production.',
          );
        }
        return {
          secret: secret ?? 'change-me',
          signOptions: {
            expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '7d') as never,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MailService, JwtStrategy],
  exports: [AuthService, MailService],
})
export class AuthModule {}
