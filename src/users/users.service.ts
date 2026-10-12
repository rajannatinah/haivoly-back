import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Utilisateur } from './entities/utilisateur.entity';
import { Role } from '../common/enums/domain.enums';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface ProfilUtilisateur {
  id: string;
  nom: string;
  prenom: string | null;
  email: string;
  telephone: string | null;
  role: string;
  creeA: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
  ) {}

  async findById(id: string): Promise<ProfilUtilisateur> {
    const utilisateur = await this.utilisateurs.findOne({ where: { id } });

    if (!utilisateur) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return this.toProfil(utilisateur);
  }

  /**
   * Portee de consultation d'un utilisateur.
   *
   * Un AGRICULTEUR ne voit que ses propres donnees. Un PROPRIETAIRE voit les
   * siennes plus celles des agriculteurs qui lui sont rattaches
   * (`proprietaireId`). Exigence du cahier des charges : §3 (le proprietaire
   * consulte parcelles et cultures) et Annexe A (controle serveur = filtrage).
   *
   * Retourne toujours au moins l'identifiant de l'appelant, donc un
   * `In(portee)` ne peut jamais etre vide.
   */
  async porteeDeConsultation(utilisateurId: string): Promise<string[]> {
    const appelant = await this.utilisateurs.findOne({
      where: { id: utilisateurId },
      select: ['id', 'role'],
    });

    if (!appelant || appelant.role !== Role.PROPRIETAIRE) {
      return [utilisateurId];
    }

    const rattaches = await this.utilisateurs.find({
      where: { proprietaireId: utilisateurId },
      select: ['id'],
    });

    return [utilisateurId, ...rattaches.map((u) => u.id)];
  }

  /**
   * Rattache (ou détache) un agriculteur à un propriétaire.
   *
   * Règles : la cible doit exister et être AGRICULTEUR, le propriétaire doit
   * exister et être PROPRIETAIRE, et l'auto-rattachement est refusé — la
   * contrainte SQL `CK_Utilisateur_pas_auto_rattachement` sert de dernier
   * filet, pas de seule défense.
   */
  async definirRattachement(
    cibleId: string,
    proprietaireId: string | null,
  ): Promise<ProfilUtilisateur> {
    const cible = await this.utilisateurs.findOne({ where: { id: cibleId } });
    if (!cible) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (cible.role !== Role.AGRICULTEUR) {
      throw new BadRequestException(
        'Seul un compte AGRICULTEUR peut être rattaché à un propriétaire',
      );
    }

    if (proprietaireId === null || proprietaireId === undefined) {
      cible.proprietaireId = null;
      return this.toProfil(await this.utilisateurs.save(cible));
    }

    if (proprietaireId === cibleId) {
      throw new BadRequestException(
        'Un utilisateur ne peut pas être rattaché à lui-même',
      );
    }

    const proprietaire = await this.utilisateurs.findOne({
      where: { id: proprietaireId },
    });
    if (!proprietaire) {
      throw new NotFoundException('Propriétaire introuvable');
    }
    if (proprietaire.role !== Role.PROPRIETAIRE) {
      throw new BadRequestException(
        'Le compte de rattachement doit avoir le rôle PROPRIETAIRE',
      );
    }

    cible.proprietaireId = proprietaireId;
    return this.toProfil(await this.utilisateurs.save(cible));
  }

  /** Utilisateurs ciblables par une recommandation (sans mot de passe). */
  async listDestinataires(): Promise<ProfilUtilisateur[]> {
    const utilisateurs = await this.utilisateurs.find({
      order: { nom: 'ASC' },
    });

    return utilisateurs.map((utilisateur) => this.toProfil(utilisateur));
  }

  async updateProfile(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<ProfilUtilisateur> {
    const utilisateur = await this.utilisateurs.findOne({ where: { id } });

    if (!utilisateur) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    Object.assign(utilisateur, {
      ...(dto.nom !== undefined && { nom: dto.nom.trim() }),
      ...(dto.prenom !== undefined && { prenom: dto.prenom?.trim() ?? null }),
      ...(dto.telephone !== undefined && {
        telephone: dto.telephone?.trim() ?? null,
      }),
    });

    return this.toProfil(await this.utilisateurs.save(utilisateur));
  }

  private toProfil(utilisateur: Utilisateur): ProfilUtilisateur {
    return {
      id: utilisateur.id,
      nom: utilisateur.nom,
      prenom: utilisateur.prenom,
      email: utilisateur.email,
      telephone: utilisateur.telephone,
      role: utilisateur.role,
      creeA: utilisateur.creeA,
    };
  }
}
