import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { ApiException } from '../../common/errors/api-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

/** Texte exploitable extrait de l'information fournie par `passport-jwt`. */
function infoTexte(info: unknown): string {
  if (typeof info === 'string') return info;
  if (info instanceof Error) return `${info.name} ${info.message}`;
  return '';
}

/**
 * Garde d'authentification enregistré globalement (APP_GUARD).
 *
 * Il doit s'exécuter AVANT le `RolesGuard` : sans cela `request.user` n'est
 * pas encore renseigné et le contrôle des rôles échoue systématiquement.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const estPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (estPublic) return true;

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: unknown,
    info: unknown,
  ): TUser {
    // Conserver les refus métier explicites de la stratégie (notamment
    // AUTH_EMAIL_NOT_VERIFIED) au lieu de les transformer en 401 générique.
    if (err instanceof ApiException) throw err;

    const texte = infoTexte(info);
    const absent = !info || /no\s*auth\s*token/i.test(texte);
    const expire = /TokenExpiredError|jwt expired/i.test(texte);

    if (err || !user) {
      if (!absent && expire) {
        throw new ApiException(
          ErrorCode.AUTH_SESSION_EXPIRED,
          'Votre session a expiré. Veuillez vous reconnecter.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      throw new ApiException(
        ErrorCode.AUTH_UNAUTHORIZED,
        absent
          ? 'Vous devez être connecté pour accéder à cette ressource.'
          : 'Votre session n’est plus valide. Veuillez vous reconnecter.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return user as TUser;
  }
}
