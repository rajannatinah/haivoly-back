import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';

import { ActiviteService } from './activite.service';
import {
  chargeJournal,
  decrireRequeteMetier,
  identifiantEntite,
  libelleEntite,
} from './description-requete';

interface RequeteHttp {
  method: string;
  route?: { path?: string };
  baseUrl?: string;
  params?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  user?: { id?: string };
  requestId?: string;
}

/** Motif de la route appariée (`/parcelles/:id`), préfixe de routeur compris. */
function cheminDeRoute(requete: RequeteHttp): string | undefined {
  const motif = requete.route?.path;
  if (typeof motif !== 'string') return undefined;
  return `${requete.baseUrl ?? ''}${motif}`;
}

/**
 * Intercepteur global (B-16) : après chaque requête métier RÉUSSIE d'un
 * utilisateur authentifié (création, modification, suppression, tracé,
 * photo), enregistre l'activité via `ActiviteService` : journal, règles,
 * notification du propriétaire. Les lectures, les échecs (exception levée
 * par le contrôleur) et les routes techniques ne sont jamais enregistrés.
 */
@Injectable()
export class ActiviteEnLigneInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActiviteEnLigneInterceptor.name);

  constructor(private readonly activite: ActiviteService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const requete = context.switchToHttp().getRequest<RequeteHttp>();
    const chemin = cheminDeRoute(requete);
    const description = decrireRequeteMetier(requete.method, chemin);
    const acteurId = requete.user?.id;
    if (!description || !acteurId) return next.handle();

    return next.handle().pipe(
      mergeMap(async (reponse: unknown) => {
        try {
          const typeContenu = requete.headers?.['content-type'];
          const { payload, tronque } = chargeJournal(
            requete.body,
            Array.isArray(typeContenu) ? typeContenu[0] : typeContenu,
          );
          await this.activite.enregistrerActionEnLigne({
            ...description,
            acteurId,
            entityId: identifiantEntite(reponse, requete.params ?? {}),
            libelle: libelleEntite(description.entityType, reponse),
            payload,
            payloadTronque: tronque,
            route: `${requete.method.toUpperCase()} ${chemin}`,
            requestId: requete.requestId ?? null,
          });
        } catch (error) {
          // Jamais d'échec visible pour l'utilisateur : l'action est enregistrée.
          this.logger.warn(
            `Activité en ligne non enregistrée: ${String(error)}`,
          );
        }
        return reponse;
      }),
    );
  }
}
