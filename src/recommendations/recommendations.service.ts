import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Recommendation } from './entities/recommendation.entity';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import { UsersService, type ApercuDestinataire } from '../users/users.service';
import { NotificationsMailService } from '../mail/notifications-mail.service';
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
import { In } from 'typeorm';

/** Diffusion à tout le périmètre de l'émetteur (alias historique du mobile). */
export const BROADCAST_ALIAS = 'all';

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendations: Repository<Recommendation>,
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
    private readonly users: UsersService,
    private readonly notifications: NotificationsMailService,
    private readonly config: ConfigService,
  ) {}

  private readonly logger = new Logger(RecommendationsService.name);

  async create(
    dto: CreateRecommendationDto,
    emitteur: AuthenticatedUser,
  ): Promise<
    | { count: number; destinataires: ApercuDestinataire[] }
    | (Recommendation & { destinataire: ApercuDestinataire })
  > {
    const expiresAt = parseDate(dto.expiresAt);
    const titre = dto.title.trim();
    const corps = dto.message.trim();
    const type = dto.type ?? RecommendationType.INFO;
    const priorite = dto.priority ?? RecommendationPriority.MEDIUM;

    // Diffusion au périmètre de l'émetteur (et non à toute la base HaiVoly).
    if (dto.userId === BROADCAST_ALIAS) {
      const portee = await this.users.porteeDeConsultation(emitteur.id);
      const cibles = await this.utilisateurs.find({
        where:
          portee.length === 1
            ? { id: portee[0], estVerifie: true }
            : { id: In(portee), estVerifie: true },
        select: { id: true },
      });

      if (cibles.length === 0) {
        throw new NotFoundException(
          'Aucun destinataire activé dans votre périmètre.',
        );
      }

      const created = await this.recommendations.save(
        cibles.map((cible) =>
          this.recommendations.create({
            userId: cible.id,
            createdById: emitteur.id,
            title: titre,
            message: corps,
            type,
            priority: priorite,
            expiresAt,
          }),
        ),
      );

      await this.notifierSiDemande(created, emitteur, titre);

      // Le client affiche ce que le serveur a réellement touché : la liste des
      // comptes atteints, avec leur nom d'utilisateur public.
      return {
        count: created.length,
        destinataires: await this.users.apercusParIds(
          cibles.map((cible) => cible.id),
        ),
      };
    }

    const destinataire = await this.users.validerDestinataire(
      dto.userId,
      emitteur.id,
    );

    const enregistre = await this.recommendations.save(
      this.recommendations.create({
        userId: destinataire.id,
        createdById: emitteur.id,
        title: titre,
        message: corps,
        type,
        priority: priorite,
        expiresAt,
      }),
    );

    await this.notifierSiDemande([enregistre], emitteur, titre);

    return Object.assign(enregistre, { destinataire });
  }

  private async notifierSiDemande(
    recommandations: Recommendation[],
    emitteur: AuthenticatedUser,
    titre: string,
  ): Promise<void> {
    const actif = this.config.get<string>('RECOMMANDATION_EMAIL_ACTIF');
    if (actif === undefined || actif.toLowerCase() !== 'true') return;

    const ids = [...new Set(recommandations.map((r) => r.userId))];
    if (ids.length === 0) return;

    try {
      // Les informations affichées dans le message viennent du compte réel, pas
      // de la requête : nom, prénom, nom d'utilisateur et langue préférée.
      const comptes = await this.utilisateurs
        .createQueryBuilder('u')
        .select([
          'u.id',
          'u.nom',
          'u.prenom',
          'u.username',
          'u.email',
          'u.langue',
        ])
        .where('u.id IN (:...ids)', { ids })
        .andWhere('u.estVerifie = :actif', { actif: true })
        .getMany();

      await Promise.all(
        comptes.map((compte) =>
          this.notifications.recommandationRecue(
            {
              id: compte.id,
              nom: compte.nom,
              prenom: compte.prenom ?? null,
              email: compte.email,
              username: compte.username,
              langue: compte.langue ?? null,
            },
            {
              url: this.urlRecommandation(
                recommandations.find((r) => r.userId === compte.id)?.id ?? '',
              ),
              emetteur: [emitteur.prenom, emitteur.nom]
                .filter(Boolean)
                .join(' '),
              titre,
            },
          ),
        ),
      );
    } catch {
      // Un échec de notification ne fait jamais échouer la publication : la
      // recommandation est déjà enregistrée et visible dans l'application.
      this.logger.warn('Notification de recommandation non programmée.');
    }
  }

  private urlRecommandation(id: string): string {
    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    return `${base.replace(/\/$/, '')}/recommandations/${id}`;
  }

  /** Liste administrateur (toutes les recommandations, filtrable). */
  async findAll(
    query: RecommendationQueryDto,
  ): Promise<PaginatedResult<Recommendation>> {
    const qb = this.recommendations
      .createQueryBuilder('r')
      .leftJoin('r.utilisateur', 'u')
      .addSelect(['u.id', 'u.nom', 'u.prenom', 'u.username'])
      .leftJoin('r.createur', 'c')
      .addSelect(['c.id', 'c.nom', 'c.prenom', 'c.username'])
      .orderBy('r.createdAt', 'DESC');

    if (query.userId)
      qb.andWhere('r.userId = :userId', { userId: query.userId });
    if (query.createdById) {
      qb.andWhere('r.createdById = :createdById', {
        createdById: query.createdById,
      });
    }
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
      .leftJoin('r.createur', 'c')
      .addSelect(['c.id', 'c.nom', 'c.prenom', 'c.username'])
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
    // `AuthenticatedUser.role` vient du JWT et reste typé `string` côté
    // transport : on le ramène au domaine avant de le comparer.
    const estProprietaire = (acteur.role as Role) === Role.PROPRIETAIRE;

    if (!recommendation || (!estDestinataire && !estProprietaire)) {
      throw new NotFoundException('Recommandation introuvable');
    }

    await this.recommendations.remove(recommendation);
    return { id, deleted: true };
  }
}
