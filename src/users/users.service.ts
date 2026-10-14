import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';

import { Utilisateur } from './entities/utilisateur.entity';
import { UsernameService } from './username.service';
import { Role } from '../common/enums/domain.enums';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RechercheUtilisateursQueryDto } from './dto/recherche-utilisateurs.dto';
import { ApiException } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/error-codes';
import { paginate, type PaginatedResult } from '../common/dto/pagination.dto';
import { normaliserUsername } from '../common/utils/username.util';
import { normaliserLangue } from '../common/utils/langue.util';
import { motifLike } from '../common/utils/sql.util';

/** Profil exposé au profil et à l'administration — jamais le hash du mot de passe. */
export interface ProfilUtilisateur {
  id: string;
  nom: string;
  prenom: string | null;
  username: string;
  email: string;
  telephone: string | null;
  role: string;
  estVerifie: boolean;
  langue: string | null;
  motDePasseProvisoire: boolean;
  creeA: Date;
}

/** Projection minimale et stable utilisée par les sélecteurs de destinataires. */
export interface ApercuDestinataire {
  id: string;
  nom: string;
  prenom: string | null;
  /** Nom complet prêt à afficher, construit côté serveur pour rester cohérent. */
  nomComplet: string;
  username: string;
  /** Absent quand la politique du projet interdit de l'exposer. */
  email?: string;
  role: string;
  estVerifie: boolean;
}

/** Une liste déroulante n'a jamais besoin de plus de 20 lignes. */
const RECHERCHE_LIMIT_MAX = 20;
/** Garde-fou de la liste non paginée : un périmètre ne dépasse pas ce volume. */
const PORTEE_LISTE_MAX = 200;
const RECHERCHE_LIMIT_DEFAUT = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
    private readonly usernames: UsernameService,
    private readonly config: ConfigService,
  ) {}

  async findById(id: string): Promise<ProfilUtilisateur> {
    const utilisateur = await this.utilisateurs.findOne({ where: { id } });

    if (!utilisateur) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return this.toProfil(utilisateur);
  }

  /**
   * Périmètre de consultation. Un PROPRIÉTAIRE a une vue plateforme : il
   * accède à toutes les données (actions, parcelles, cultures, interventions,
   * observations, récoltes), quel que soit le rattachement des comptes. Les
   * autres rôles (agriculteurs) restent cloisonnés à leurs propres données.
   */
  async porteeDeConsultation(utilisateurId: string): Promise<string[]> {
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

  async rechercherDestinataires(
    query: RechercheUtilisateursQueryDto,
    appelantId: string,
  ): Promise<PaginatedResult<ApercuDestinataire>> {
    const appelant = await this.utilisateurs.findOne({
      where: { id: appelantId },
      select: ['id', 'role'],
    });

    if (!appelant) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const portee = await this.porteeDeConsultation(appelantId);
    const terme = (query.q ?? '').trim();

    const qb = this.utilisateurs
      .createQueryBuilder('u')
      .select(this.champsDestinataire.map((champ) => `u.${champ}`))
      .where('u.id IN (:...portee)', { portee })
      .andWhere('(u.estVerifie = :actif OR u.proprietaireId = :appelantId)', {
        actif: true,
        appelantId,
      })
      .orderBy('UPPER(u.nom)', 'ASC')
      .addOrderBy('UPPER(u.prenom)', 'ASC')
      .addOrderBy('u.id', 'ASC');

    if (terme) {
      const motif = motifLike(terme);
      const usernameExact = normaliserUsername(terme.replace(/^@/, ''));

      // Recherche multicritère sur les seuls champs autorisés. Les jokers saisis
      // sont échappés : taper `%` cherche un pourcentage, pas toute la table.
      const clauses: Array<{ sql: string; params: Record<string, string> }> = [
        { sql: 'LOWER(u.nom) LIKE LOWER(:motif)', params: { motif } },
        {
          sql: "LOWER(COALESCE(u.prenom, '')) LIKE LOWER(:motif)",
          params: { motif },
        },
        {
          sql: "LOWER(u.nom || ' ' || COALESCE(u.prenom, '')) LIKE LOWER(:motif)",
          params: { motif },
        },
        { sql: 'u.username LIKE LOWER(:motif)', params: { motif } },
        // Correspondance exacte sur `@rindra` : le préfixe d'affichage est retiré.
        ...(usernameExact
          ? [{ sql: 'u.username = :usernameExact', params: { usernameExact } }]
          : []),
        ...(this.emailVisible
          ? [{ sql: 'LOWER(u.email) LIKE LOWER(:motif)', params: { motif } }]
          : []),
      ];

      qb.andWhere(
        new Brackets((or) => {
          for (const clause of clauses) {
            or.orWhere(clause.sql, clause.params);
          }
        }),
      );
    }

    const limite = Math.min(
      RECHERCHE_LIMIT_MAX,
      Math.max(1, query.take ?? RECHERCHE_LIMIT_DEFAUT),
    );
    const page = Math.max(1, query.page ?? 1);
    const saut = Number.isFinite(query.skip) ? query.skip : (page - 1) * limite;

    const [items, total] = await qb.skip(saut).take(limite).getManyAndCount();

    return paginate(
      items.map((utilisateur) => this.toApercuDestinataire(utilisateur)),
      total,
      page,
      limite,
    );
  }

  async listDestinataires(appelantId: string): Promise<ApercuDestinataire[]> {
    const portee = await this.porteeDeConsultation(appelantId);
    if (portee.length === 0) return [];

    const utilisateurs = await this.utilisateurs.find({
      where: { id: In(portee), estVerifie: true },
      select: this.champsDestinataire,
      order: { nom: 'ASC' },
      take: PORTEE_LISTE_MAX,
    });

    return utilisateurs.map((utilisateur) =>
      this.toApercuDestinataire(utilisateur),
    );
  }

  /**
   * Vue d'administration du périmètre : tous les comptes rattachés, y compris
   * ceux dont l'adresse n'est pas encore confirmée. Sert à la page
   * « Utilisateurs » du web ; contrairement aux destinataires, aucun filtre
   * `estVerifie` n'est appliqué.
   */
  async listerUtilisateurs(appelantId: string): Promise<ApercuDestinataire[]> {
    const portee = await this.porteeDeConsultation(appelantId);
    if (portee.length === 0) return [];

    const utilisateurs = await this.utilisateurs.find({
      where: { id: In(portee) },
      select: this.champsDestinataire,
      order: { nom: 'ASC' },
      take: PORTEE_LISTE_MAX,
    });

    return utilisateurs.map((utilisateur) =>
      this.toApercuDestinataire(utilisateur),
    );
  }

  async apercusParIds(ids: string[]): Promise<ApercuDestinataire[]> {
    if (ids.length === 0) return [];

    const utilisateurs = await this.utilisateurs.find({
      where: { id: In(ids) },
      select: this.champsDestinataire,
      order: { nom: 'ASC' },
      take: PORTEE_LISTE_MAX,
    });

    return utilisateurs.map((utilisateur) =>
      this.toApercuDestinataire(utilisateur),
    );
  }

  private get champsDestinataire(): Array<keyof Utilisateur> {
    return [
      'id',
      'nom',
      'prenom',
      'username',
      'role',
      'estVerifie',
      ...(this.emailVisible ? (['email'] as const) : []),
    ] as Array<keyof Utilisateur>;
  }

  async validerDestinataire(
    destinataireId: string,
    emitteurId: string,
  ): Promise<ApercuDestinataire> {
    const destinataire = await this.utilisateurs.findOne({
      where: { id: destinataireId },
    });

    if (!destinataire) {
      throw new ApiException(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Destinataire introuvable.',
        HttpStatus.NOT_FOUND,
      );
    }

    const portee = await this.porteeDeConsultation(emitteurId);
    if (!portee.includes(destinataire.id)) {
      throw new ApiException(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Destinataire introuvable.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!destinataire.estVerifie) {
      throw new ApiException(
        ErrorCode.USER_RECIPIENT_NOT_ALLOWED,
        "Ce compte n'a pas encore confirmé son adresse e-mail : il ne peut pas recevoir de recommandation. Relancez l'activation depuis la fiche du compte.",
        HttpStatus.FORBIDDEN,
      );
    }

    return this.toApercuDestinataire(destinataire);
  }

  async updateProfile(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<ProfilUtilisateur> {
    const utilisateur = await this.utilisateurs.findOne({ where: { id } });

    if (!utilisateur) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    // Le nom d'utilisateur est normalisé, validé et contrôlé en unicité par le
    // service dédié ; l'index unique tranche en dernier recours.
    const username =
      dto.username !== undefined
        ? await this.usernames.normaliserEtValider(dto.username, undefined, id)
        : utilisateur.username;

    Object.assign(utilisateur, {
      ...(dto.nom !== undefined && { nom: dto.nom.trim() }),
      ...(dto.prenom !== undefined && { prenom: dto.prenom?.trim() ?? null }),
      ...(dto.telephone !== undefined && {
        telephone: dto.telephone?.trim() ?? null,
      }),
      ...(dto.langue !== undefined && {
        langue: normaliserLangue(dto.langue ?? ''),
      }),
      username,
    });

    const enregistre = await this.enregistrerProfil(utilisateur);
    return this.toProfil(enregistre);
  }

  /** Conflit de nom d'utilisateur à l'écriture : message explicite, sans fuite. */
  private async enregistrerProfil(
    utilisateur: Utilisateur,
  ): Promise<Utilisateur> {
    try {
      return await this.utilisateurs.save(utilisateur);
    } catch (erreur) {
      const detail = erreur as { code?: string; constraint?: string } | null;
      if (
        detail?.code === '23505' &&
        (detail.constraint ?? '').includes('username')
      ) {
        throw new ApiException(
          ErrorCode.USER_USERNAME_ALREADY_EXISTS,
          "Ce nom d'utilisateur vient d'être pris.",
          HttpStatus.CONFLICT,
        );
      }
      if (
        detail?.code === '23505' &&
        (detail.constraint ?? '').includes('email')
      ) {
        throw new ApiException(
          ErrorCode.USER_EMAIL_ALREADY_EXISTS,
          'Un compte existe déjà avec cette adresse e-mail.',
          HttpStatus.CONFLICT,
        );
      }
      this.logger.error('Écriture du profil impossible.');
      throw erreur;
    }
  }

  private get emailVisible(): boolean {
    const brut = this.config.get<string>('USERS_SEARCH_EMAIL_VISIBLE');
    return brut === undefined ? true : brut.toLowerCase() !== 'false';
  }

  private toApercuDestinataire(
    utilisateur: Utilisateur & { email?: string },
  ): ApercuDestinataire {
    const nomComplet = [utilisateur.prenom, utilisateur.nom]
      .filter((valeur): valeur is string => Boolean(valeur && valeur.trim()))
      .join(' ')
      .trim();

    return {
      id: utilisateur.id,
      nom: utilisateur.nom,
      prenom: utilisateur.prenom ?? null,
      nomComplet: nomComplet || utilisateur.username,
      username: utilisateur.username,
      ...(this.emailVisible && utilisateur.email
        ? { email: utilisateur.email }
        : {}),
      role: utilisateur.role,
      estVerifie: utilisateur.estVerifie,
    };
  }

  private toProfil(utilisateur: Utilisateur): ProfilUtilisateur {
    return {
      id: utilisateur.id,
      nom: utilisateur.nom,
      prenom: utilisateur.prenom,
      username: utilisateur.username,
      email: utilisateur.email,
      telephone: utilisateur.telephone,
      role: utilisateur.role,
      estVerifie: utilisateur.estVerifie,
      langue: utilisateur.langue ?? null,
      motDePasseProvisoire: utilisateur.motDePasseProvisoire === true,
      creeA: utilisateur.creeA,
    };
  }
}
