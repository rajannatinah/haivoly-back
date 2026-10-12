import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {In, Repository } from 'typeorm';

import { Observation } from './entities/observation.entity';
import { UsersService } from '../users/users.service';
import { Culture } from '../cultures/entities/culture.entity';
import { StatutCulture } from '../common/enums/domain.enums';
import {
  CreateObservationDto,
  UpdateObservationDto,
} from './dto/observation.dto';
import { parseDate, requireDate } from '../common/utils/date.util';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Observation)
    private readonly observations: Repository<Observation>,
    @InjectRepository(Culture)
    private readonly cultures: Repository<Culture>,
  ) {}

  private async requireCulture(
    cultureId: string,
    utilisateurId: string,
    parcelleId?: string,
  ): Promise<Culture> {
    const portee = await this.usersService.porteeDeConsultation(utilisateurId);
    const culture = await this.cultures.findOne({
      where: {
        id: cultureId,
        ...(parcelleId ? { parcelleId } : {}),
        parcelle: { utilisateurId: In(portee) },
      },
    });

    if (!culture || culture.statut === StatutCulture.SUPPRIMEE) {
      throw new NotFoundException('Culture introuvable');
    }

    return culture;
  }

  private assertModifiable(culture: Culture, action: string): void {
    if (
      culture.statut === StatutCulture.RECOLTEE ||
      culture.statut === StatutCulture.ABANDONNEE
    ) {
      throw new ForbiddenException(
        `Impossible de ${action} une observation pour cette culture`,
      );
    }
  }

  async create(
    cultureId: string,
    dto: CreateObservationDto,
    utilisateurId: string,
    parcelleId?: string,
  ) {
    const culture = await this.requireCulture(
      cultureId,
      utilisateurId,
      parcelleId,
    );
    this.assertModifiable(culture, 'créer');

    const observation = this.observations.create({
      description: dto.description.trim(),
      date: dto.date ? requireDate(dto.date, 'date') : new Date(),
      cultureId,
    });

    return this.observations.save(observation);
  }

  async findAll(
    cultureId: string,
    utilisateurId: string,
    parcelleId?: string,
  ): Promise<Observation[]> {
    await this.requireCulture(cultureId, utilisateurId, parcelleId);

    return this.observations.find({
      where: { cultureId },
      relations: { photos: true },
      order: { date: 'DESC' },
    });
  }

  async findOne(
    cultureId: string,
    id: string,
    utilisateurId: string,
    parcelleId?: string,
  ): Promise<Observation> {
    await this.requireCulture(cultureId, utilisateurId, parcelleId);

    const observation = await this.observations.findOne({
      where: { id, cultureId },
      relations: { photos: true },
    });

    if (!observation) {
      throw new NotFoundException('Observation introuvable');
    }

    return observation;
  }

  async update(
    cultureId: string,
    id: string,
    dto: UpdateObservationDto,
    utilisateurId: string,
    parcelleId?: string,
  ) {
    const culture = await this.requireCulture(
      cultureId,
      utilisateurId,
      parcelleId,
    );
    this.assertModifiable(culture, 'modifier');

    const observation = await this.observations.findOne({
      where: { id, cultureId },
    });

    if (!observation) {
      throw new NotFoundException('Observation introuvable');
    }

    Object.assign(observation, {
      ...(dto.description !== undefined && {
        description: dto.description.trim(),
      }),
      ...(dto.date !== undefined && {
        date: parseDate(dto.date) ?? observation.date,
      }),
    });

    await this.observations.save(observation);

    return this.observations.findOne({
      where: { id },
      relations: { photos: true },
    });
  }

  async remove(
    cultureId: string,
    id: string,
    utilisateurId: string,
    parcelleId?: string,
  ) {
    const culture = await this.requireCulture(
      cultureId,
      utilisateurId,
      parcelleId,
    );
    this.assertModifiable(culture, 'supprimer');

    const observation = await this.observations.findOne({
      where: { id, cultureId },
    });

    if (!observation) {
      throw new NotFoundException('Observation introuvable');
    }

    await this.observations.remove(observation);
    return { id, deleted: true };
  }

  async findOneById(id: string, utilisateurId: string): Promise<Observation> {
    const observation = await this.requireOwnedObservation(id, utilisateurId);
    return this.findOne(observation.cultureId, id, utilisateurId);
  }

  async updateById(
    id: string,
    dto: UpdateObservationDto,
    utilisateurId: string,
  ) {
    const observation = await this.requireOwnedObservation(id, utilisateurId);
    return this.update(observation.cultureId, id, dto, utilisateurId);
  }

  async removeById(id: string, utilisateurId: string) {
    const observation = await this.requireOwnedObservation(id, utilisateurId);
    return this.remove(observation.cultureId, id, utilisateurId);
  }

  /** Vérification d'ownership partagée avec le module photos. */
  async requireOwnedObservation(
    observationId: string,
    utilisateurId: string,
    cultureId?: string,
  ): Promise<Observation> {
    const observation = await this.observations.findOne({
      where: {
        id: observationId,
        ...(cultureId ? { cultureId } : {}),
        culture: { parcelle: { utilisateurId } },
      },
      relations: { culture: true },
    });

    if (
      !observation ||
      observation.culture?.statut === StatutCulture.SUPPRIMEE
    ) {
      throw new NotFoundException('Observation introuvable');
    }

    return observation;
  }
}
