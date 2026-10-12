import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Recolte } from './entities/recolte.entity';
import { UsersService } from '../users/users.service';
import { PhotoRecolte } from '../photos-recoltes/entities/photo-recolte.entity';
import { Culture } from '../cultures/entities/culture.entity';
import { StatutCulture } from '../common/enums/domain.enums';
import { CreateRecolteDto, UpdateRecolteDto } from './dto/recolte.dto';
import { requireDateOnly, toDateOnly } from '../common/utils/date.util';
import { statutCultureAJour } from '../common/utils/culture-statut.util';
import type { PaginatedResult } from '../common/dto/pagination.dto';
import { paginate } from '../common/dto/pagination.dto';

@Injectable()
export class RecoltesService {
  private readonly logger = new Logger(RecoltesService.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Recolte)
    private readonly recoltes: Repository<Recolte>,
    @InjectRepository(Culture)
    private readonly cultures: Repository<Culture>,
    @InjectRepository(PhotoRecolte)
    private readonly photoRecoltes: Repository<PhotoRecolte>,
  ) {}

  async create(
    cultureId: string,
    dto: CreateRecolteDto,
    utilisateurId: string,
  ) {
    const culture = await this.cultures.findOne({
      where: { id: cultureId, parcelle: { utilisateurId } },
    });

    if (!culture || culture.statut === StatutCulture.SUPPRIMEE) {
      throw new NotFoundException('Culture introuvable');
    }

    const statutAJour = statutCultureAJour(
      culture.statut,
      culture.datePlantation,
    );

    if (statutAJour !== StatutCulture.EN_COURS) {
      throw new BadRequestException(
        'Seule une culture en cours peut être récoltée',
      );
    }

    const existante = await this.recoltes.findOne({ where: { cultureId } });
    if (existante) {
      throw new ConflictException('Cette culture possède déjà une récolte');
    }

    // Date calendaire : comparée sous forme de chaîne `YYYY-MM-DD`
    // (l'ordre lexicographique est identique à l'ordre chronologique).
    const dateRecolte = requireDateOnly(dto.dateRecolte, 'dateRecolte');

    const plantation = toDateOnly(culture.datePlantation);

    if (plantation && dateRecolte < plantation) {
      throw new BadRequestException(
        'La date de récolte ne peut pas être avant la date de plantation',
      );
    }

    const recolte = await this.recoltes.manager.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(Recolte, {
          dateRecolte,
          quantite: dto.quantite,
          unite: dto.unite.trim(),
          description: dto.description?.trim() ?? null,
          prixVente: dto.prixVente ?? null,
          coutRecolte: dto.coutRecolte ?? null,
          cultureId,
        }),
      );

      // ➜ Transition automatique du cycle de vie de la culture
      await manager.update(
        Culture,
        { id: cultureId },
        { statut: StatutCulture.RECOLTEE },
      );

      this.logger.log(
        `[create] récolte ${created.id} → culture ${cultureId} = RECOLTEE`,
      );

      return created;
    });

    return this.recoltes.findOne({
      where: { id: recolte.id },
      relations: { photos: true },
    });
  }

  async findAll(
    utilisateurId: string,
    page = 1,
    limit = 50,
  ): Promise<PaginatedResult<Recolte>> {
    // Portee elargie pour un PROPRIETAIRE (cahier des charges §3, Annexe A).
    const portee = await this.usersService.porteeDeConsultation(utilisateurId);
    const [items, total] = await this.recoltes.findAndCount({
      where: { culture: { parcelle: { utilisateurId: In(portee) } } },
      relations: { culture: { parcelle: true }, photos: true },
      order: { dateRecolte: 'DESC' },
      skip: (Math.max(1, page) - 1) * Math.min(200, Math.max(1, limit)),
      take: Math.min(200, Math.max(1, limit)),
    });

    return paginate(items, total, page, limit);
  }

  async findOne(cultureId: string, utilisateurId: string): Promise<Recolte> {
    const culture = await this.cultures.findOne({
      where: { id: cultureId, parcelle: { utilisateurId } },
    });

    if (!culture || culture.statut === StatutCulture.SUPPRIMEE) {
      throw new NotFoundException('Culture introuvable');
    }

    const recolte = await this.recoltes.findOne({
      where: { cultureId },
      relations: { photos: true },
      order: { photos: { dateAjout: 'DESC' } },
    });

    if (!recolte) {
      throw new NotFoundException(
        'Aucune récolte enregistrée pour cette culture',
      );
    }

    return recolte;
  }

  async requireOwnedRecolte(
    recolteId: string,
    utilisateurId: string,
  ): Promise<Recolte> {
    const recolte = await this.recoltes.findOne({
      where: { id: recolteId, culture: { parcelle: { utilisateurId } } },
      relations: { culture: true },
    });

    if (!recolte) {
      throw new NotFoundException('Récolte introuvable');
    }

    return recolte;
  }

  async update(id: string, _dto: UpdateRecolteDto, utilisateurId: string) {
    await this.requireOwnedRecolte(id, utilisateurId);
    throw new BadRequestException(
      'Une récolte appartenant à une culture récoltée ne peut plus être modifiée',
    );
  }

  /** Idem : la suppression casserait l'historique. */
  async remove(id: string, utilisateurId: string) {
    await this.requireOwnedRecolte(id, utilisateurId);
    throw new BadRequestException(
      'Impossible de supprimer une récolte d’une culture récoltée',
    );
  }

  async uploadPhoto(recolteId: string, utilisateurId: string, url: string) {
    const recolte = await this.requireOwnedRecolte(recolteId, utilisateurId);

    if (recolte.culture.statut !== StatutCulture.RECOLTEE) {
      throw new BadRequestException(
        'La culture doit être récoltée pour ajouter une photo',
      );
    }

    return this.photoRecoltes.save(
      this.photoRecoltes.create({ url, recolteId }),
    );
  }
}
