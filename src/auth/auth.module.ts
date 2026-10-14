import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthMaintenanceService } from './auth-maintenance.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PasswordSetupToken } from './entities/password-setup-token.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Utilisateur,
      PasswordResetToken,
      PasswordSetupToken,
      EmailVerificationToken,
    ]),
    ConfigModule,
    PassportModule,
    // L'envoi des messages n'est pas la responsabilité de l'authentification :
    // le module mail fournit transport, file d'envoi et modèles.
    MailModule,
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
  providers: [AuthService, JwtStrategy, AuthMaintenanceService],
  exports: [AuthService],
})
export class AuthModule {}
