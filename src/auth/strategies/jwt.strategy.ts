import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Utilisateur } from '../../users/entities/utilisateur.entity';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ApiException } from '../../common/errors/api-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token invalide');
    }

    const utilisateur = await this.utilisateurs.findOne({
      where: { id: payload.sub },
    });

    if (!utilisateur) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    const verificationRequise =
      this.configService
        .get<string>('EMAIL_VERIFICATION_REQUISE')
        ?.toLowerCase() !== 'false';
    if (verificationRequise && !utilisateur.estVerifie) {
      throw new ApiException(
        ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
        'Votre adresse e-mail n’a pas encore été confirmée. Consultez votre boîte de réception pour activer votre compte.',
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      id: utilisateur.id,
      nom: utilisateur.nom,
      prenom: utilisateur.prenom,
      email: utilisateur.email,
      telephone: utilisateur.telephone,
      role: utilisateur.role,
    };
  }
}
