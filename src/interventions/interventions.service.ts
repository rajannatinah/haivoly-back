import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {In, Repository } from 'typeorm';

import { Intervention } from './entities/intervention.entity';
import { UsersService } from '../users/users.service';
import { Culture } from '../cultures/entities/culture.entity';
import { StatutCulture } from '../common/enums/domain.enums';
import {
  CreateInterventionDto,
  UpdateInterventionDto,
} from './dto/intervention.dto';
import {
  computeInterventionStatus,
  normalizeInterventionStatus,
} from './intervention-status.util';
import { requireDate } from '../common/utils/date.util';

@Injectable()
export class InterventionsService {
  private readonly logger = new Logger(InterventionsService.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Intervention)
    private readonly interventions: Repository<Intervention>,
    @InjectRepository(Culture)
    private readonly cultures: Repository<Culture>,
  ) {}

  private async requireCulture(
    parcelleIdFromRoute: string | undefined,
    cultureId: string,
    utilisateurId: string,
  ): Promise<Culture> {
    const portee = await this.usersService.porteeDeConsultation(utilisateurId);
    const culture = await this.cultures.findOne({
      where: {
        id: cultureId,
        ...(parcelleIdFromRoute ? { parcelleId: parcelleIdFromRoute } : {}),
        parcelle: { utilisateurId: In(portee) },
      },
    });

    if (!culture || culture.statut === StatutCulture.SUPPRIMEE) {
      throw new NotFoundException('Culture introuvable');
    }

    return culture;
  }

  private assertCultureModifiable(culture: Culture, action: string): void {
    if (
      culture.statut === StatutCulture.RECOLTEE ||
      culture.statut === StatutCulture.ABANDONNEE
    ) {
      throw new ForbiddenException(
        `Cette culture est terminée et ses interventions ne peuvent plus être ${action}`,
      );
    }
  }

  async create(
    cultureId: string,
    dto: CreateInterventionDto,
    utilisateurId: string,
    parcelleIdFromRoute?: string,
  ) {
    const culture = await this.requireCulture(
      parcelleIdFromRoute,
      cultureId,
      utilisateurId,
    );
    this.assertCultureModifiable(culture, 'créées');

    const date = dto.date ? requireDate(dto.date, 'date') : new Date();

    const intervention = this.interventions.create({
      type: dto.type,
      description: dto.description?.trim() ?? null,
      date,
      produit: dto.produit?.trim() ?? null,
      quantite: dto.quantite ?? null,
      unite: dto.unite?.trim() ?? null,
      cout: dto.cout ?? null,
      cultureId,
    });

    // Le statut est TOUJOURS déduit de la date côté backend.
    intervention.statut = computeInterventionStatus(date);

    const saved = await this.interventions.save(intervention);
    this.logger.log(
      `[create] intervention ${saved.id} (${saved.statut}) culture=${cultureId}`,
    );

    return saved;
  }

  async findAll(
    cultureId: string,
    utilisateurId: string,
    parcelleIdFromRoute?: string,
  ): Promise<Intervention[]> {
    await this.requireCulture(parcelleIdFromRoute, cultureId, utilisateurId);

    const interventions = await this.interventions.find({
      where: { cultureId },
      relations: { photos: true },
      order: { date: 'DESC' },
    });

    return this.normalizeAll(interventions);
  }

  async findOne(
    cultureId: string,
    id: string,
    utilisateurId: string,
    parcelleIdFromRoute?: string,
  ): Promise<Intervention> {
    await this.requireCulture(parcelleIdFromRoute, cultureId, utilisateurId);

    const intervention = await this.interventions.findOne({
      where: { id, cultureId },
      relations: { photos: true },
    });

    if (!intervention) {
      throw new NotFoundException('Intervention introuvable');
    }

    return intervention;
  }

  private async cultureIdDe(
    id: string,
    utilisateurId: string,
  ): Promise<string> {
    const intervention = await this.interventions.findOne({
      where: { id },
      select: { id: true, cultureId: true },
    });

    if (!intervention) {
      throw new NotFoundException('Intervention introuvable');
    }

    await this.requireCulture(undefined, intervention.cultureId, utilisateurId);

    return intervention.cultureId;
  }

  async findOneById(id: string, utilisateurId: string): Promise<Intervention> {
    return this.findOne(
      await this.cultureIdDe(id, utilisateurId),
      id,
      utilisateurId,
    );
  }

  async updateById(
    id: string,
    dto: UpdateInterventionDto,
    utilisateurId: string,
  ) {
    return this.update(
      await this.cultureIdDe(id, utilisateurId),
      id,
      dto,
      utilisateurId,
    );
  }

  async removeById(id: string, utilisateurId: string) {
    return this.remove(
      await this.cultureIdDe(id, utilisateurId),
      id,
      utilisateurId,
    );
  }

  /** Recherche brute (sans contrôle d'ownership) — usage interne sync. */
  async findOneRaw(id: string): Promise<Intervention | null> {
    return this.interventions.findOne({ where: { id } });
  }

  async update(
    cultureId: string,
    id: string,
    dto: UpdateInterventionDto,
    utilisateurId: string,
    parcelleIdFromRoute?: string,
  ) {
    const culture = await this.requireCulture(
      parcelleIdFromRoute,
      cultureId,
      utilisateurId,
    );
    this.assertCultureModifiable(culture, 'modifiées');

    const intervention = await this.interventions.findOne({
      where: { id, cultureId },
    });

    if (!intervention) {
      throw new NotFoundException('Intervention introuvable');
    }

    if (dto.date !== undefined) {
      intervention.date = requireDate(dto.date, 'date');
    }

    Object.assign(intervention, {
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.description !== undefined && {
        description: dto.description?.trim() ?? null,
      }),
      ...(dto.produit !== undefined && {
        produit: dto.produit?.trim() ?? null,
      }),
      ...(dto.quantite !== undefined && { quantite: dto.quantite }),
      ...(dto.unite !== undefined && { unite: dto.unite?.trim() ?? null }),
      ...(dto.cout !== undefined && { cout: dto.cout }),
    });

    // Recalcul du statut après toute modification (date incluse).
    intervention.statut = normalizeInterventionStatus(
      intervention.statut,
      intervention.date,
    );

    return this.interventions.save(intervention);
  }

  async remove(
    cultureId: string,
    id: string,
    utilisateurId: string,
    parcelleIdFromRoute?: string,
  ) {
    const culture = await this.requireCulture(
      parcelleIdFromRoute,
      cultureId,
      utilisateurId,
    );
    this.assertCultureModifiable(culture, 'supprimées');

    const intervention = await this.interventions.findOne({
      where: { id, cultureId },
    });

    if (!intervention) {
      throw new NotFoundException('Intervention introuvable');
    }

    await this.interventions.remove(intervention);

    return { id, deleted: true };
  }

  private async normalizeAll(
    interventions: Intervention[],
  ): Promise<Intervention[]> {
    const now = new Date();
    const toUpdate: Intervention[] = [];

    for (const intervention of interventions) {
      const expected = normalizeInterventionStatus(
        intervention.statut,
        intervention.date,
        now,
      );
      if (expected !== intervention.statut) {
        intervention.statut = expected;
        toUpdate.push(intervention);
      }
    }

    if (toUpdate.length > 0) {
      await this.interventions.save(toUpdate);
    }

    return interventions;
  }
}
