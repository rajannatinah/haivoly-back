import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Recommendation } from './entities/recommendation.entity';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import {
  RecommendationPriority,
  RecommendationType,
} from '../common/enums/domain.enums';
import {
  CreateRecommendationDto,
  RecommendationQueryDto,
} from './dto/recommendation.dto';
import type { PaginatedResult } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/domain.enums';
import { paginate } from '../common/dto/pagination.dto';
import { parseDate } from '../common/utils/date.util';

const BROADCAST_ALIAS = 'all';

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendations: Repository<Recommendation>,
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
  ) {}

  async create(dto: CreateRecommendationDto) {
    const expiresAt = parseDate(dto.expiresAt);

    // Diffusion à tous les utilisateurs
    if (dto.userId === BROADCAST_ALIAS) {
      const users = await this.utilisateurs.find({ select: { id: true } });

      const created = await this.recommendations.save(
        users.map((u) =>
          this.recommendations.create({
            userId: u.id,
            title: dto.title.trim(),
            message: dto.message.trim(),
            type: dto.type ?? RecommendationType.INFO,
            priority: dto.priority ?? RecommendationPriority.MEDIUM,
            expiresAt,
          }),
        ),
      );

      return { count: created.length, recommendations: created };
    }

    return this.recommendations.save(
      this.recommendations.create({
        userId: dto.userId,
        title: dto.title.trim(),
        message: dto.message.trim(),
        type: dto.type ?? RecommendationType.INFO,
        priority: dto.priority ?? RecommendationPriority.MEDIUM,
        expiresAt,
      }),
    );
  }

  /** Liste administrateur (toutes les recommandations, filtrable). */
  async findAll(
    query: RecommendationQueryDto,
  ): Promise<PaginatedResult<Recommendation>> {
    const qb = this.recommendations
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.utilisateur', 'u')
      .orderBy('r.createdAt', 'DESC');

    if (query.userId)
      qb.andWhere('r.userId = :userId', { userId: query.userId });
    if (query.type) qb.andWhere('r.type = :type', { type: query.type });
    if (query.priority) {
      qb.andWhere('r.priority = :priority', { priority: query.priority });
    }
    if (query.unread === 'true') qb.andWhere('r.readAt IS NULL');

    const [items, total] = await qb
      .skip((Math.max(1, query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20)
      .getManyAndCount();

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  /** Recommandations de l'utilisateur connecté (les expirées sont exclues). */
  async findForUser(
    userId: string,
    unreadOnly = false,
    includeExpired = false,
  ): Promise<Recommendation[]> {
    const qb = this.recommendations
      .createQueryBuilder('r')
      .where('r.userId = :userId', { userId })
      .orderBy('r.createdAt', 'DESC')
      .take(100);

    if (unreadOnly) {
      qb.andWhere('r.readAt IS NULL');
    }

    if (!includeExpired) {
      qb.andWhere('(r.expiresAt IS NULL OR r.expiresAt > NOW())');
    }

    return qb.getMany();
  }

  /** Compteur de non-lues (badge mobile). */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.recommendations.count({
      where: { userId, readAt: IsNull() },
    });
    return { count };
  }

  async markRead(id: string, userId: string): Promise<Recommendation> {
    const recommendation = await this.recommendations.findOne({
      where: { id },
    });

    if (!recommendation || recommendation.userId !== userId) {
      throw new NotFoundException('Recommandation introuvable');
    }

    if (!recommendation.readAt) {
      recommendation.readAt = new Date();
      await this.recommendations.save(recommendation);
    }

    return recommendation;
  }

  async markUnread(id: string, userId: string): Promise<Recommendation> {
    const recommendation = await this.recommendations.findOne({
      where: { id },
    });

    if (!recommendation || recommendation.userId !== userId) {
      throw new NotFoundException('Recommandation introuvable');
    }

    recommendation.readAt = null;
    return this.recommendations.save(recommendation);
  }

  async markAllReadForUser(userId: string): Promise<{ updated: number }> {
    const result = await this.recommendations.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );

    return { updated: result.affected ?? 0 };
  }

  async remove(
    id: string,
    acteur: AuthenticatedUser,
  ): Promise<{ id: string; deleted: true }> {
    const recommendation = await this.recommendations.findOne({
      where: { id },
    });

    const estDestinataire = recommendation?.userId === acteur.id;
    const estProprietaire = acteur.role === Role.PROPRIETAIRE;

    if (!recommendation || (!estDestinataire && !estProprietaire)) {
      throw new NotFoundException('Recommandation introuvable');
    }

    await this.recommendations.remove(recommendation);
    return { id, deleted: true };
  }
}
