import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Action } from '../actions/entities/action.entity';
import { ActionsService } from '../actions/actions.service';
import { SyncStatus } from '../common/enums/domain.enums';
import type { DescriptionRequete } from './description-requete';

export interface ActionEnLigne extends DescriptionRequete {
  acteurId: string;
  entityId: string | null;
  libelle: string | null;
  payload: Record<string, unknown> | null;
  /** Corps non conservé car trop volumineux. */
  payloadTronque: boolean;
  route: string;
  requestId: string | null;
}

/**
 * Activité terrain faite EN LIGNE (B-16) : même traitement qu'une action
 * synchronisée hors ligne, pour que chaque action mobile — quel que soit le
 * canal — produise exactement :
 * - une ligne de journal (`Action`, canal `EN_LIGNE`), visible par le
 *   propriétaire sur le web (journal, KPI) ;
 * - les recommandations automatiques existantes (règles métier) ;
 * - une notification du propriétaire rattaché (`notifierActionProprietaire`).
 * Les actions hors ligne restent traitées par `POST /sync` (aucun doublon :
 * la synchronisation appelle les services métier directement, sans passer par
 * les contrôleurs ni par l'intercepteur).
 * Un échec ici ne fait jamais échouer l'action de l'utilisateur.
 */
@Injectable()
export class ActiviteService {
  private readonly logger = new Logger(ActiviteService.name);

  constructor(
    @InjectRepository(Action)
    private readonly actions: Repository<Action>,
    private readonly actionsService: ActionsService,
  ) {}

  async enregistrerActionEnLigne(action: ActionEnLigne): Promise<void> {
    const maintenant = new Date();
    try {
      await this.actions.save(
        this.actions.create({
          clientId: null,
          userId: action.acteurId,
          actionType: action.actionType,
          entityType: action.entityType,
          entityId: action.entityId,
          payload: action.payload,
          metadata: {
            canal: 'EN_LIGNE',
            route: action.route,
            requestId: action.requestId,
            ...(action.libelle ? { libelle: action.libelle } : {}),
            ...(action.payloadTronque ? { payloadTronque: true } : {}),
          },
          deviceId: null,
          timestamp: maintenant,
          syncStatus: SyncStatus.SYNCED,
          syncedAt: maintenant,
          retryCount: 0,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Journal d'activité en ligne non écrit: ${String(error)}`,
      );
    }

    try {
      await this.actionsService.triggerRecommendationRules({
        userId: action.acteurId,
        actionType: `${action.actionType}_${action.entityType}`,
        payload: action.payload,
        entityType: action.entityType,
      });
    } catch (error) {
      this.logger.warn(`Règles de recommandation en échec: ${String(error)}`);
    }

    // `notifierActionProprietaire` ne lève jamais (erreurs journalisées).
    await this.actionsService.notifierActionProprietaire({
      acteurId: action.acteurId,
      actionType: action.actionType,
      entityType: action.entityType,
      entityId: action.entityId,
      canal: 'EN_LIGNE',
      libelle: action.libelle,
    });
  }
}
