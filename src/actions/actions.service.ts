import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { Action } from './entities/action.entity';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import { CreateActionDto } from './dto/create-action.dto';
import {
  RecommendationPriority,
  RecommendationType,
  SyncStatus,
} from '../common/enums/domain.enums';
import { parseDate } from '../common/utils/date.util';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';

export interface ActionQuery {
  userId?: string;
  actionType?: string;
  entityType?: string;
  syncStatus?: string;
  search?: string;
  page?: number;
  limit?: number;
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
        where: { clientId: dto.clientId },
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

    if (query.userId)
      qb.andWhere('a.userId = :userId', { userId: query.userId });
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
      where: { userId, syncStatus: SyncStatus.FAILED },
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
        this.actions.count({ where: { syncStatus: SyncStatus.FAILED } }),
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
          await this.recommendations.save(
            this.recommendations.create({
              userId: context.userId,
              title: 'Bienvenue — première parcelle créée',
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
