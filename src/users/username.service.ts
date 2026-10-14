import {
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';

import { Utilisateur } from './entities/utilisateur.entity';
import { ApiException } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/error-codes';
import {
  avecSuffixe,
  candidatsUsername,
  normaliserUsername,
  USERNAME_LONGUEUR_MAX,
  validerFormatUsername,
  type SourceUsername,
} from '../common/utils/username.util';

/** Collisions résolues par suffixe numérique avant de passer à l'aléatoire. */
const MAX_TENTATIVES_SUFFIXE = 20;
/** Tentatives de suffixe aléatoire si la zone numérique est saturée. */
const MAX_TENTATIVES_ALEATOIRE = 8;
/** Re-tentatives d'INSERTION (course entre deux inscriptions simultanées). */
export const MAX_TENTATIVES_INSERTION = 5;

const CARACTERES_HASARD = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Nom de la contrainte unique posée par la migration (dernier rempart). */
export const CONTRAINTE_USERNAME_UNIQUE = 'UQ_Utilisateur_username';

@Injectable()
export class UsernameService {
  private readonly logger = new Logger(UsernameService.name);

  constructor(
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
  ) {}

  /** Le nom est-il déjà attribué ? `manager` permet de vérifier dans la transaction appelante. */
  async estPris(
    username: string,
    manager?: EntityManager,
    exclusId?: string,
  ): Promise<boolean> {
    const repository = manager
      ? manager.getRepository(Utilisateur)
      : this.utilisateurs;

    // `exists` plutôt qu'un chargement : on teste une existence, aucun champ
    // sensible n'est lu ni conservé en mémoire.
    return repository.exists({
      where: exclusId ? { username, id: Not(exclusId) } : { username },
    });
  }

  async genererDisponible(
    source: SourceUsername,
    manager?: EntityManager,
    exclusId?: string,
  ): Promise<string> {
    const candidats = candidatsUsername(source);

    for (const base of candidats) {
      for (let rang = 1; rang <= MAX_TENTATIVES_SUFFIXE; rang += 1) {
        const proposition = avecSuffixe(base, rang);
        if (!this.estConforme(proposition)) continue;
        if (!(await this.estPris(proposition, manager, exclusId))) {
          return proposition;
        }
      }
    }

    const amorce = candidats[0] ?? 'utilisateur';
    for (let essai = 0; essai < MAX_TENTATIVES_ALEATOIRE; essai += 1) {
      const proposition = this.suffixeHasard(amorce);
      if (!this.estConforme(proposition)) continue;
      if (!(await this.estPris(proposition, manager, exclusId))) {
        return proposition;
      }
    }

    this.logger.error(
      'Attribution d’un nom d’utilisateur impossible : tentatives épuisées.',
    );
    throw new ServiceUnavailableException(
      "Impossible d'attribuer un nom d’utilisateur pour le moment. Réessayez.",
    );
  }

  async normaliserEtValider(
    brut: string,
    manager?: EntityManager,
    exclusId?: string,
  ): Promise<string> {
    const normalise = normaliserUsername(brut);
    const verdict = validerFormatUsername(normalise);

    if (!verdict.valide) {
      throw new ApiException(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        this.messageMotif(verdict.motif),
        HttpStatus.BAD_REQUEST,
      );
    }

    if (await this.estPris(normalise, manager, exclusId)) {
      throw new ApiException(
        ErrorCode.USER_USERNAME_ALREADY_EXISTS,
        "Ce nom d'utilisateur est déjà pris.",
        HttpStatus.CONFLICT,
      );
    }

    return normalise;
  }

  async avecRepriseSurCollision<T>(
    source: SourceUsername,
    operation: (username: string) => Promise<T>,
    options?: { manager?: EntityManager; exclusId?: string; username?: string },
  ): Promise<T> {
    for (
      let tentative = 1;
      tentative <= MAX_TENTATIVES_INSERTION;
      tentative += 1
    ) {
      const username = options?.username
        ? await this.normaliserEtValider(
            options.username,
            options.manager,
            options.exclusId,
          )
        : await this.genererDisponible(
            source,
            options?.manager,
            options?.exclusId,
          );

      try {
        return await operation(username);
      } catch (erreur) {
        if (!estCollisionUsername(erreur)) throw erreur;
        // Aucune donnée personnelle en log : uniquement le fait technique.
        this.logger.warn(
          `Nom d’utilisateur pris entre la vérification et l’insertion (tentative ${tentative}/${MAX_TENTATIVES_INSERTION}).`,
        );
        if (options?.username) {
          // Un choix explicite de l'utilisateur ne doit pas être remplacé par un
          // nom généré : on remonte immédiatement le conflit.
          throw new ApiException(
            ErrorCode.USER_USERNAME_ALREADY_EXISTS,
            "Ce nom d'utilisateur vient d'être pris. Choisissez-en un autre.",
            HttpStatus.CONFLICT,
          );
        }
      }
    }

    throw new ApiException(
      ErrorCode.RESOURCE_CONFLICT,
      "Le nom d'utilisateur vient d'être attribué à un autre compte. Réessayez.",
      HttpStatus.CONFLICT,
    );
  }

  private estConforme(valeur: string): boolean {
    return (
      valeur.length <= USERNAME_LONGUEUR_MAX &&
      validerFormatUsername(valeur).valide
    );
  }

  private suffixeHasard(base: string): string {
    let queue = '';
    for (let i = 0; i < 4; i += 1) {
      queue +=
        CARACTERES_HASARD[Math.floor(Math.random() * CARACTERES_HASARD.length)];
    }
    return normaliserUsername(`${base}${queue}`).slice(
      0,
      USERNAME_LONGUEUR_MAX,
    );
  }

  private messageMotif(motif?: string): string {
    switch (motif) {
      case 'TROP_COURT':
        return 'Le nom d’utilisateur doit contenir au moins 3 caractères.';
      case 'TROP_LONG':
        return 'Le nom d’utilisateur ne peut pas dépasser 30 caractères.';
      case 'CARACTERES_NON_AUTORISES':
        return "Le nom d'utilisateur ne peut contenir que des lettres minuscules, des chiffres, des points, des tirets bas et des tirets.";
      case 'FORME_INVALIDE':
        return 'Le nom d’utilisateur doit commencer par une lettre et ne peut pas se terminer par un séparateur.';
      default:
        return "Le nom d'utilisateur est invalide.";
    }
  }
}

/** L'erreur vient-elle de la contrainte unique `username` de PostgreSQL ? */
export function estCollisionUsername(erreur: unknown): boolean {
  const detail = erreur as {
    code?: string;
    constraint?: string;
    constraintName?: string;
  } | null;
  if (detail?.code !== '23505') return false;
  const contrainte = detail.constraint ?? detail.constraintName ?? '';
  return contrainte.includes('username');
}
