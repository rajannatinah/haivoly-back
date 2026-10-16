import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { Action } from './entities/action.entity';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import { CreateActionDto } from './dto/create-action.dto';
import {
  RecommendationPriority,
  RecommendationType,
  Role,
  SyncStatus,
} from '../common/enums/domain.enums';
import { parseDate } from '../common/utils/date.util';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';

/** Canal d'une action terrain (métadonnée des notifications et du journal). */
export type CanalActivite = 'EN_LIGNE' | 'SYNC' | 'JOURNAL';

/** Recommandation de bienvenue : une seule fois par utilisateur (N-12). */
export const TITRE_BIENVENUE_PREMIERE_PARCELLE =
  'Bienvenue — première parcelle créée';

export interface ActionQuery {
  userId?: string;
  actionType?: string;
  entityType?: string;
  syncStatus?: string;
  search?: string;
  page?: number;
  limit?: number;
  /** Auteur de la requête : sert au calcul du périmètre de consultation. */
  demandeurId?: string;
  /** Le propriétaire voit les actions de tous ses agriculteurs rattachés. */
  estProprietaire?: boolean;
}

@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(
    @InjectRepository(Action)
    private readonly actions: Repository<Action>,
    @InjectRepository(Recommendation)
    private readonly recommendations: Repository<Recommendation>,
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
  ) {}

  async create(userId: string, dto: CreateActionDto) {
    if (dto.clientId) {
      const existing = await this.actions.findOne({
        where: { clientId: dto.clientId, userId },
      });

      if (existing) {
        return {
          id: dto.clientId,
          status: 'DUPLICATE' as const,
          action: existing,
        };
      }
    }

    const action = await this.actions.save(
      this.actions.create({
        clientId: dto.clientId ?? null,
        userId,
        actionType: dto.actionType,
        entityType: dto.entityType,
        entityId: dto.entityId ?? null,
        payload: dto.payload ?? null,
        metadata: dto.metadata ?? null,
        deviceId: dto.deviceId ?? null,
        timestamp: parseDate(dto.timestamp) ?? new Date(),
        syncStatus: SyncStatus.SYNCED,
        syncedAt: new Date(),
      }),
    );

    await this.triggerRecommendationRules({
      userId,
      actionType: `${dto.actionType}_${dto.entityType}`,
      payload: dto.payload ?? null,
      entityType: dto.entityType,
    });

    // Notifie le propriétaire rattaché : chaque action d'un agriculteur doit
    // apparaître dans son centre de notifications pour pilotage.
    await this.notifierActionProprietaire({
      acteurId: userId,
      actionType: dto.actionType,
      entityType: dto.entityType,
      entityId: action.entityId ?? null,
      canal: 'JOURNAL',
    });

    return {
      id: action.clientId ?? action.id,
      status: 'SYNCED' as const,
      action,
    };
  }

  async findAll(query: ActionQuery): Promise<PaginatedResult<Action>> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const qb = this.actions
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.utilisateur', 'u')
      .orderBy('a.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // Le propriétaire voit les actions de tous ses agriculteurs rattachés ;
    // l'agriculteur ne voit que les siennes. Un filtre `userId` explicite est
    // ignoré pour un agriculteur (cloisonnement).
    if (query.estProprietaire) {
      if (query.userId) {
        qb.andWhere('a.userId = :userId', { userId: query.userId });
      } else if (query.demandeurId) {
        const portee = await this.porteeDeConsultation(query.demandeurId);
        qb.andWhere('a.userId IN (:...portee)', { portee });
      }
    } else if (query.demandeurId) {
      qb.andWhere('a.userId = :userId', { userId: query.demandeurId });
    } else if (query.userId) {
      qb.andWhere('a.userId = :userId', { userId: query.userId });
    }

    if (query.actionType) {
      qb.andWhere('a.actionType = :actionType', {
        actionType: query.actionType,
      });
    }
    if (query.entityType) {
      qb.andWhere('a.entityType = :entityType', {
        entityType: query.entityType,
      });
    }
    if (query.syncStatus) {
      qb.andWhere('a.syncStatus = :syncStatus', {
        syncStatus: query.syncStatus,
      });
    }
    if (query.search) {
      qb.andWhere(
        '(a.actionType ILIKE :search OR a.entityType ILIKE :search OR a.entityId ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, page, limit);
  }

  async findOne(
    id: string,
    demandeur?: { id: string; role?: string },
  ): Promise<Action> {
    const action = await this.actions.findOne({
      where: { id },
      relations: { utilisateur: true },
    });

    // Pas de divulgation de l'existence de la ressource à un non-propriétaire.
    const autorise =
      !demandeur ||
      demandeur.role === 'PROPRIETAIRE' ||
      action?.userId === demandeur.id;

    if (!action || !autorise) {
      throw new NotFoundException('Action introuvable');
    }

    return action;
  }

  /** Actions en échec de l'utilisateur (écran « synchronisation » mobile). */
  async failedForUser(userId: string): Promise<Action[]> {
    return this.actions.find({
      where: {
        userId,
        syncStatus: In([SyncStatus.FAILED, SyncStatus.INVALID, SyncStatus.CONFLICT]),
      },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  async stats() {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [totalUsers, totalActions, today, synced, pending, failed, recos] =
      await Promise.all([
        this.utilisateurs.count(),
        this.actions.count(),
        this.actions.count({
          where: { timestamp: MoreThanOrEqual(startOfDay) },
        }),
        this.actions.count({ where: { syncStatus: SyncStatus.SYNCED } }),
        this.actions.count({
          where: [
            { syncStatus: SyncStatus.PENDING },
            { syncStatus: SyncStatus.SYNCING },
          ],
        }),
        this.actions.count({
          where: {
            syncStatus: In([SyncStatus.FAILED, SyncStatus.INVALID, SyncStatus.CONFLICT]),
          },
        }),
        this.recommendations.count(),
      ]);

    return {
      totalUsers,
      totalActions,
      actionsToday: today,
      actionsSynced: synced,
      actionsPending: pending,
      actionsFailed: failed,
      recommendations: recos,
      syncRate: totalActions
        ? Math.round((synced / totalActions) * 1000) / 10
        : 100,
    };
  }

  /**
   * Notifie le propriétaire rattaché à l'auteur lorsqu'un agriculteur réalise
   * une action. La recommandation s'affiche dans le centre de notifications du
   * propriétaire (page Recommandations du web, notifications du mobile).
   * Un échec de notification ne fait jamais échouer l'action.
   */
  async notifierActionProprietaire(params: {
    acteurId: string;
    actionType: string;
    entityType: string;
    entityId?: string | null;
    /** Canal de l'action : en ligne (routes métier), synchronisation, journal. */
    canal?: CanalActivite;
    /** Élément concerné (« Rizière Nord », « Irrigation »…), s'il est connu. */
    libelle?: string | null;
  }): Promise<void> {
    try {
      const acteur = await this.utilisateurs.findOne({
        where: { id: params.acteurId },
        select: ['id', 'role', 'proprietaireId', 'nom', 'prenom'],
      });

      if (!acteur || acteur.role !== Role.AGRICULTEUR) {
        return;
      }

      // Le propriétaire rattaché si connu ; sinon tous les propriétaires de la
      // plateforme (vue globale) afin qu'aucune action terrain ne soit ignorée.
      const destinataires = acteur.proprietaireId
        ? [acteur.proprietaireId]
        : (
            await this.utilisateurs.find({
              where: { role: Role.PROPRIETAIRE },
              select: ['id'],
            })
          ).map((proprietaire) => proprietaire.id);

      if (destinataires.length === 0) {
        return;
      }

      const nomActeur =
        [acteur.prenom, acteur.nom]
          .filter((valeur): valeur is string =>
            Boolean(valeur && valeur.trim()),
          )
          .join(' ')
          .trim() || 'Un agriculteur';
      const action = this.decrireAction(params.actionType, params.entityType);

      await this.recommendations.save(
        destinataires.map((userId) =>
          this.recommendations.create({
            userId,
            title: `Action terrain : ${action}`,
            message: `${nomActeur} a effectué « ${action} » sur le terrain${
              params.libelle ? ` : « ${params.libelle} »` : ''
            }. Consultez le journal des actions pour en savoir plus.`,
            type: RecommendationType.INFO,
            priority: RecommendationPriority.LOW,
            metadata: {
              origine: 'ACTION_AGRICULTEUR',
              acteurId: acteur.id,
              actionType: params.actionType,
              entityType: params.entityType,
              entityId: params.entityId ?? null,
              ...(params.canal ? { canal: params.canal } : {}),
              ...(params.libelle ? { libelle: params.libelle } : {}),
            },
          }),
        ),
      );
    } catch (error) {
      // Une notification manquée ne doit jamais bloquer l'enregistrement.
      this.logger.warn(
        `Notification propriétaire non programmée: ${String(error)}`,
      );
    }
  }

  /** Libellé lisible d'une action pour la notification du propriétaire. */
  private decrireAction(actionType: string, entityType: string): string {
    const [verbe, entiteBrute] = actionType.includes('_')
      ? actionType.split('_')
      : [actionType, entityType];

    const verbes: Record<string, string> = {
      CREATE: 'Création',
      UPDATE: 'Modification',
      DELETE: 'Suppression',
    };
    const entites: Record<string, string> = {
      PARCELLE: 'parcelle',
      CULTURE: 'culture',
      INTERVENTION: 'intervention',
      OBSERVATION: 'observation',
      RECOLTE: 'récolte',
      POINT_GPS: 'point GPS',
      PHOTO: 'photo',
    };

    return `${verbes[verbe] ?? verbe} • ${
      entites[entiteBrute] ?? entiteBrute.toLowerCase()
    }`;
  }

  /**
   * Périmètre de consultation. Un PROPRIÉTAIRE voit toutes les actions de la
   * plateforme (y compris celles des comptes non rattachés) ; un agriculteur
   * ne voit que les siennes.
   */
  private async porteeDeConsultation(utilisateurId: string): Promise<string[]> {
    const appelant = await this.utilisateurs.findOne({
      where: { id: utilisateurId },
      select: ['id', 'role'],
    });

    if (!appelant || appelant.role !== Role.PROPRIETAIRE) {
      return [utilisateurId];
    }

    const tous = await this.utilisateurs.find({ select: ['id'] });
    return tous.map((u) => u.id);
  }

  private labelOf(value: unknown): string {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
    return 'sans nom';
  }

  async triggerRecommendationRules(context: {
    userId: string;
    actionType: string;
    entityType: string;
    payload: Record<string, unknown> | null;
  }): Promise<void> {
    const rules: Array<() => Promise<void>> = [
      async () => {
        if (context.actionType === 'CREATE_PARCELLE') {
          // « Première parcelle » : envoyée une seule fois (elle se répétait à
          // chaque création, N-12 ; plus visible encore avec les actions en ligne).
          const dejaEnvoyee = await this.recommendations.exists({
            where: {
              userId: context.userId,
              title: TITRE_BIENVENUE_PREMIERE_PARCELLE,
            },
          });
          if (dejaEnvoyee) return;
          await this.recommendations.save(
            this.recommendations.create({
              userId: context.userId,
              title: TITRE_BIENVENUE_PREMIERE_PARCELLE,
              message: `Parcelle « ${this.labelOf(
                context.payload?.nom,
              )} » créée. Pensez à délimiter la zone GPS pour calculer la superficie.`,
              type: RecommendationType.SUCCESS,
              priority: RecommendationPriority.MEDIUM,
              metadata: { entityType: context.entityType },
            }),
          );
        }
      },
      async () => {
        // Humidité basse → irrigation recommandée
        const humidite = Number(context.payload?.humidite);
        if (
          context.actionType === 'CREATE_OBSERVATION' &&
          Number.isFinite(humidite) &&
          humidite < 30
        ) {
          await this.recommendations.save(
            this.recommendations.create({
              userId: context.userId,
              title: 'Irrigation recommandée',
              message: `Humidité basse (${humidite}%) détectée. Prévoir une irrigation dans les 24 heures.`,
              type: RecommendationType.WARNING,
              priority: RecommendationPriority.HIGH,
              metadata: { entityType: context.entityType },
            }),
          );
        }
      },
      async () => {
        // Récolte enregistrée → confirmation
        if (context.actionType === 'CREATE_RECOLTE') {
          await this.recommendations.save(
            this.recommendations.create({
              userId: context.userId,
              title: 'Récolte enregistrée',
              message:
                'Votre récolte a été enregistrée. La culture est désormais marquée comme récoltée.',
              type: RecommendationType.SUCCESS,
              priority: RecommendationPriority.LOW,
              metadata: { entityType: context.entityType },
            }),
          );
        }
      },
    ];

    for (const rule of rules) {
      try {
        await rule();
      } catch (error) {
        this.logger.warn(`Règle de recommandation en échec: ${String(error)}`);
      }
    }
  }
}
