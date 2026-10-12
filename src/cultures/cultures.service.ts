import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Culture } from './entities/culture.entity';
import { UsersService } from '../users/users.service';
import { PointGPSCulture } from './entities/point-gps-culture.entity';
import { Parcelle } from '../parcelles/entities/parcelle.entity';
import { Recolte } from '../recoltes/entities/recolte.entity';
import { StatutCulture, StatutParcelle } from '../common/enums/domain.enums';
import { CreateCultureDto } from './dto/creation-culture.dto';
import { UpdateCultureDto } from './dto/modification-culture.dto';
import { calculerSuperficie } from '../common/utils/geo.util';
import { statutCultureAJour } from '../common/utils/culture-statut.util';
import type { PaginatedResult } from '../common/dto/pagination.dto';
import { paginate } from '../common/dto/pagination.dto';
const TRANSITIONS_AUTORISEES: Record<StatutCulture, StatutCulture[]> = {
  [StatutCulture.PLANIFIEE]: [
    StatutCulture.EN_COURS,
    StatutCulture.ABANDONNEE,
    StatutCulture.SUPPRIMEE,
  ],
  [StatutCulture.EN_COURS]: [StatutCulture.RECOLTEE, StatutCulture.ABANDONNEE],
  [StatutCulture.RECOLTEE]: [],
  [StatutCulture.ABANDONNEE]: [
    StatutCulture.PLANIFIEE,
    StatutCulture.SUPPRIMEE,
  ],
  [StatutCulture.SUPPRIMEE]: [],
};
@Injectable()
export class CulturesService {
  private readonly logger = new Logger(CulturesService.name);
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Culture)
    private readonly cultures: Repository<Culture>,
    @InjectRepository(PointGPSCulture)
    private readonly points: Repository<PointGPSCulture>,
    @InjectRepository(Recolte)
    private readonly recoltes: Repository<Recolte>,
  ) {}
  async requireOwnership(
    cultureId: string,
    utilisateurId: string,
    options: { parcelleId?: string; includeDeleted?: boolean } = {},
  ): Promise<Culture> {
    // Portee elargie : un PROPRIETAIRE accede aux cultures de ses agriculteurs
    // rattaches (cahier des charges §3 et Annexe A, controle serveur = filtrage).
    const portee = await this.usersService.porteeDeConsultation(utilisateurId);
    const culture = await this.cultures.findOne({
      where: {
        id: cultureId,
        ...(options.parcelleId ? { parcelleId: options.parcelleId } : {}),
        parcelle: { utilisateurId: In(portee) },
      },
      relations: { parcelle: true },
    });
    if (!culture) {
      throw new NotFoundException('Culture introuvable');
    }
    if (!options.includeDeleted && culture.statut === StatutCulture.SUPPRIMEE) {
      throw new NotFoundException('Culture introuvable');
    }
    return culture;
  }
  async create(
    parcelleId: string,
    dto: CreateCultureDto,
    utilisateurId: string,
  ) {
    const parcelle = await this.cultures.manager.findOne(Parcelle, {
      where: { id: parcelleId, utilisateurId },
    });
    if (!parcelle) {
      throw new NotFoundException('Parcelle introuvable');
    }
    if (parcelle.statut === StatutParcelle.SUPPRIMEE) {
      throw new BadRequestException(
        'Impossible d’ajouter une culture sur une parcelle supprimée',
      );
    }
    // Valeurs calendaires : conservées telles quelles (`YYYY-MM-DD`).
    // Aucune conversion en Date n'est faite ici → aucun décalage possible.
    const datePlantation = dto.datePlantation ?? null;
    const datePrevueRecolte = dto.datePrevueRecolte ?? null;
    if (
      datePlantation &&
      datePrevueRecolte &&
      datePrevueRecolte < datePlantation
    ) {
      throw new BadRequestException(
        'La date prévue de récolte doit être après la date de plantation',
      );
    }
    const culture = this.cultures.create({
      nom: dto.nom.trim(),
      type: dto.type?.trim() ?? null,
      variete: dto.variete?.trim() ?? null,
      description: dto.description?.trim() ?? null,
      stade: dto.stade?.trim() ?? null,
      datePlantation,
      datePrevueRecolte,
      statut: dto.statut ?? StatutCulture.PLANIFIEE,
      parcelleId,
    });
    const saved = await this.cultures.save(culture);
    if (dto.pointsGPS && dto.pointsGPS.length >= 3) {
      await this.savePointsGPS(
        parcelleId,
        saved.id,
        utilisateurId,
        dto.pointsGPS,
      );
    }
    this.logger.log(`[create] culture ${saved.id} sur parcelle ${parcelleId}`);
    return this.reconcilierStatut(
      await this.cultures.findOne({ where: { id: saved.id } }),
    );
  }
  async findAll(
    parcelleId: string,
    utilisateurId: string,
    page = 1,
    limit = 50,
  ): Promise<PaginatedResult<Culture>> {
    const porteeListe =
      await this.usersService.porteeDeConsultation(utilisateurId);
    const parcelle = await this.cultures.manager.findOne(Parcelle, {
      where: { id: parcelleId, utilisateurId: In(porteeListe) },
    });
    if (!parcelle) {
      throw new NotFoundException('Parcelle introuvable');
    }
    const [items, total] = await this.cultures.findAndCount({
      where: { parcelleId },
      relations: { recolte: true },
      order: { creeA: 'DESC' },
      skip: (Math.max(1, page) - 1) * Math.min(200, Math.max(1, limit)),
      take: Math.min(200, Math.max(1, limit)),
    });
    return paginate(await this.reconcilierStatuts(items), total, page, limit);
  }
  /** Toutes les cultures de l'utilisateur (écrans « historique », « récoltes »). */
  async findAllForUser(
    utilisateurId: string,
    page = 1,
    limit = 50,
    statut?: StatutCulture,
  ): Promise<PaginatedResult<Culture>> {
    // Portee elargie pour un PROPRIETAIRE (cahier des charges §3, Annexe A).
    const portee = await this.usersService.porteeDeConsultation(utilisateurId);
    const [items, total] = await this.cultures.findAndCount({
      where: {
        parcelle: { utilisateurId: In(portee) },
        ...(statut ? { statut } : {}),
      },
      relations: { parcelle: true, recolte: true },
      order: { creeA: 'DESC' },
      skip: (Math.max(1, page) - 1) * Math.min(200, Math.max(1, limit)),
      take: Math.min(200, Math.max(1, limit)),
    });
    return paginate(await this.reconcilierStatuts(items), total, page, limit);
  }
  /** `parcelleId` facultatif : la route plate `/cultures/:id` l'omet. */
  async findOne(
    parcelleId: string | undefined,
    id: string,
    utilisateurId: string,
  ) {
    const culture = await this.requireOwnership(id, utilisateurId, {
      parcelleId,
      includeDeleted: true,
    });
    const [pointsGPS, recolte] = await Promise.all([
      this.points.find({ where: { cultureId: id }, order: { ordre: 'ASC' } }),
      this.recoltes.findOne({
        where: { cultureId: id },
        relations: { photos: true },
      }),
    ]);
    return {
      ...(await this.reconcilierStatut(culture)),
      pointsGPS,
      recolte,
    };
  }
  async update(
    parcelleId: string,
    id: string,
    dto: UpdateCultureDto,
    utilisateurId: string,
  ) {
    const culture = await this.requireOwnership(id, utilisateurId, {
      parcelleId,
      includeDeleted: true,
    });
    if (
      culture.statut === StatutCulture.RECOLTEE ||
      culture.statut === StatutCulture.SUPPRIMEE
    ) {
      throw new BadRequestException(
        'Impossible de modifier une culture récoltée ou supprimée',
      );
    }
    if (dto.statut !== undefined && dto.statut !== culture.statut) {
      this.verifierTransitionStatut(culture.statut, dto.statut);
    }
    const datePlantation =
      dto.datePlantation !== undefined
        ? dto.datePlantation
        : culture.datePlantation;
    const datePrevueRecolte =
      dto.datePrevueRecolte !== undefined
        ? dto.datePrevueRecolte
        : culture.datePrevueRecolte;
    if (
      datePlantation &&
      datePrevueRecolte &&
      datePrevueRecolte < datePlantation
    ) {
      throw new BadRequestException(
        'La date prévue de récolte doit être après la date de plantation',
      );
    }
    Object.assign(culture, {
      ...(dto.nom !== undefined && { nom: dto.nom.trim() }),
      ...(dto.type !== undefined && { type: dto.type?.trim() ?? null }),
      ...(dto.variete !== undefined && {
        variete: dto.variete?.trim() ?? null,
      }),
      ...(dto.description !== undefined && {
        description: dto.description?.trim() ?? null,
      }),
      ...(dto.stade !== undefined && { stade: dto.stade?.trim() ?? null }),
      ...(dto.datePlantation !== undefined && { datePlantation }),
      ...(dto.datePrevueRecolte !== undefined && { datePrevueRecolte }),
      ...(dto.statut !== undefined && { statut: dto.statut }),
    });
    await this.cultures.save(culture);
    if (dto.pointsGPS && dto.pointsGPS.length >= 3) {
      await this.savePointsGPS(parcelleId, id, utilisateurId, dto.pointsGPS);
    }
    return this.findOne(parcelleId, id, utilisateurId);
  }
  async remove(
    parcelleId: string,
    id: string,
    utilisateurId: string,
    raison?: string,
  ) {
    const culture = await this.requireOwnership(id, utilisateurId, {
      parcelleId,
      includeDeleted: true,
    });
    if (culture.statut === StatutCulture.SUPPRIMEE) {
      throw new BadRequestException('Cette culture est déjà supprimée');
    }
    culture.statut = StatutCulture.SUPPRIMEE;
    culture.raisonSuppression = raison?.trim() ?? null;
    await this.cultures.save(culture);
    return culture;
  }
  async findPointsGPS(
    parcelleId: string,
    cultureId: string,
    utilisateurId: string,
  ) {
    await this.requireOwnership(cultureId, utilisateurId, { parcelleId });
    return this.points.find({ where: { cultureId }, order: { ordre: 'ASC' } });
  }
  async savePointsGPS(
    parcelleId: string,
    cultureId: string,
    utilisateurId: string,
    points: { latitude: number; longitude: number; ordre: number }[],
  ) {
    await this.requireOwnership(cultureId, utilisateurId, {
      parcelleId,
      includeDeleted: true,
    });
    if (points.length !== 0 && points.length < 3) {
      throw new BadRequestException(
        'Une délimitation doit comporter au moins 3 points GPS.',
      );
    }
    return this.cultures.manager.transaction(async (manager) => {
      await manager.delete(PointGPSCulture, { cultureId });
      if (points.length === 0) {
        return [];
      }
      return manager.save(
        points.map((point) =>
          manager.create(PointGPSCulture, {
            cultureId,
            latitude: point.latitude,
            longitude: point.longitude,
            ordre: point.ordre,
          }),
        ),
      );
    });
  }
  /** Superficie délimitée d'une culture (m²) — utilisée par le mobile. */
  async superficieCulture(cultureId: string): Promise<number | null> {
    const points = await this.points.find({
      where: { cultureId },
      order: { ordre: 'ASC' },
    });
    if (points.length < 3) return null;
    return calculerSuperficie(points);
  }
  private async reconcilierStatut<T extends Culture | null | undefined>(
    culture: T,
  ): Promise<T> {
    if (!culture) return culture;

    const statut = statutCultureAJour(culture.statut, culture.datePlantation);

    if (statut === culture.statut) return culture;

    culture.statut = statut;
    await this.cultures.update({ id: culture.id }, { statut });
    this.logger.log(
      `[statut] culture ${culture.id} → ${statut} (date de plantation atteinte)`,
    );

    return culture;
  }

  /** Version « lot » : une seule requête de mise à jour pour toute la page. */
  private async reconcilierStatuts(items: Culture[]): Promise<Culture[]> {
    const aBasculer = items.filter(
      (culture) =>
        statutCultureAJour(culture.statut, culture.datePlantation) !==
        culture.statut,
    );

    if (aBasculer.length === 0) return items;

    await this.cultures.update(
      { id: In(aBasculer.map((culture) => culture.id)) },
      { statut: StatutCulture.EN_COURS },
    );
    aBasculer.forEach((culture) => {
      culture.statut = StatutCulture.EN_COURS;
    });
    this.logger.log(
      `[statut] ${aBasculer.length} culture(s) → EN_COURS (date de plantation atteinte)`,
    );

    return items;
  }

  private verifierTransitionStatut(
    actuel: StatutCulture,
    nouveau: StatutCulture,
  ): void {
    if (actuel === nouveau) {
      throw new BadRequestException(`La culture est déjà au statut ${actuel}`);
    }
    if (!TRANSITIONS_AUTORISEES[actuel].includes(nouveau)) {
      throw new BadRequestException(
        `Transition de statut impossible : ${actuel} → ${nouveau}`,
      );
    }
  }
  /** Exposé pour les autres modules (récoltes, sync). */
  static verifierTransition(
    actuel: StatutCulture,
    nouveau: StatutCulture,
  ): void {
    if (!TRANSITIONS_AUTORISEES[actuel].includes(nouveau)) {
      throw new BadRequestException(
        `Transition de statut impossible : ${actuel} → ${nouveau}`,
      );
    }
  }
  /** Marque une culture comme récoltée (utilisé dans une transaction). */
  async markAsRecoltee(
    manager: EntityManager,
    cultureId: string,
  ): Promise<void> {
    await manager.update(
      Culture,
      { id: cultureId },
      { statut: StatutCulture.RECOLTEE },
    );
  }
}
