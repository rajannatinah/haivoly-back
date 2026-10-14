import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CleMessageEmail,
  construireMessage,
  libelleConfirmationAdresse,
  resoudreLangueEmail,
  type ContexteEmail,
  type MessageEmail,
} from './mail-modeles';
import { MailOutboxService } from './mail-outbox.service';
import { MailTransportService } from './mail-transport.service';

/** Compte réduit au strict nécessaire pour rédiger un message. */
export interface DestinataireEmail {
  id: string;
  nom: string;
  prenom: string | null;
  email: string;
  username: string;
  langue?: string | null;
}

export interface ResultatNotification {
  /** Le message a été accepté par la file (pas encore nécessairement livré). */
  programme: boolean;
  /** Un ordre identique était déjà en file : aucun doublon n'a été créé. */
  nouveau: boolean;
  /** Tentative d'envoi immédiat réussie. */
  envoye: boolean;
}

@Injectable()
export class NotificationsMailService {
  constructor(
    private readonly transport: MailTransportService,
    private readonly file: MailOutboxService,
    private readonly config: ConfigService,
  ) {}

  async bienvenueAvecVerification(
    destinataire: DestinataireEmail,
    options: { urlVerification?: string | null; dureeMinutes?: number } = {},
  ): Promise<ResultatNotification> {
    const contenu = this.construire(CleMessageEmail.BIENVENUE, destinataire, {
      ...(options.urlVerification ? { url: options.urlVerification } : {}),
      ...(options.dureeMinutes ? { dureeMinutes: options.dureeMinutes } : {}),
    });

    // Un seul ordre par compte et par jeton : un renvoi émet un nouveau jeton,
    // donc une nouvelle clé, et l'ancien ordre ne peut pas être rejoué.
    const cle = `bienvenue:${destinataire.id}:${hashDe(contenu.sujet + (options.urlVerification ?? ''))}`;

    return this.programmer(
      CleMessageEmail.BIENVENUE,
      destinataire,
      contenu,
      cle,
    );
  }

  /** Rappel du lien de vérification seul (compte déjà créé, adresse non confirmée). */
  async rappelVerification(
    destinataire: DestinataireEmail,
    urlVerification: string,
    dureeMinutes: number,
  ): Promise<ResultatNotification> {
    const contenu = this.construire(
      CleMessageEmail.VERIFICATION,
      destinataire,
      {
        url: urlVerification,
        dureeMinutes,
      },
    );
    return this.programmer(
      CleMessageEmail.VERIFICATION,
      destinataire,
      contenu,
      `verification:${destinataire.id}:${hashDe(urlVerification)}`,
    );
  }

  /** Compte créé par un responsable : activation + lien d'initialisation du mot de passe. */
  async activationCompte(
    destinataire: DestinataireEmail,
    options: {
      urlInitialisation: string;
      dureeMinutes: number;
      /** Confirmation d'adresse requise : on la propose dans le même message. */
      urlVerification?: string | null;
    },
  ): Promise<ResultatNotification> {
    const contenu = this.construire(
      CleMessageEmail.ACTIVATION_COMPTE,
      destinataire,
      {
        url: options.urlInitialisation,
        dureeMinutes: options.dureeMinutes,
        ...(options.urlVerification
          ? {
              urlSecondaire: options.urlVerification,
              libelleSecondaire: libelleConfirmationAdresse(
                this.langue(destinataire),
              ),
            }
          : {}),
      },
    );
    return this.programmer(
      CleMessageEmail.ACTIVATION_COMPTE,
      destinataire,
      contenu,
      `activation:${destinataire.id}:${hashDe(options.urlInitialisation)}`,
    );
  }

  /** Réinitialisation du mot de passe. */
  async reinitialisationMotDePasse(
    destinataire: DestinataireEmail,
    options: { urlReinitialisation: string; dureeMinutes: number },
  ): Promise<ResultatNotification> {
    const contenu = this.construire(
      CleMessageEmail.REINITIALISATION_MOT_DE_PASSE,
      destinataire,
      { url: options.urlReinitialisation, dureeMinutes: options.dureeMinutes },
    );
    return this.programmer(
      CleMessageEmail.REINITIALISATION_MOT_DE_PASSE,
      destinataire,
      contenu,
      `reset:${destinataire.id}:${hashDe(options.urlReinitialisation)}`,
    );
  }

  /** Notification métier : nouvelle recommandation reçue. */
  async recommandationRecue(
    destinataire: DestinataireEmail,
    options: { url: string; emetteur?: string | null; titre?: string | null },
  ): Promise<ResultatNotification> {
    const contenu = this.construire(
      CleMessageEmail.RECOMMANDATION,
      destinataire,
      {
        url: options.url,
        emetteur: options.emetteur ?? null,
        titreRecommandation: options.titre ?? null,
      },
    );
    return this.programmer(
      CleMessageEmail.RECOMMANDATION,
      destinataire,
      contenu,
      `recommandation:${destinataire.id}:${hashDe(options.url)}`,
    );
  }

  private construire(
    cle: (typeof CleMessageEmail)[keyof typeof CleMessageEmail],
    destinataire: Pick<
      DestinataireEmail,
      'nom' | 'prenom' | 'username' | 'langue'
    >,
    surContexte: Partial<ContexteEmail> = {},
  ): MessageEmail {
    return construireMessage(
      cle,
      {
        appName: this.appName,
        prenom: destinataire.prenom,
        nom: destinataire.nom,
        username: destinataire.username,
        ...surContexte,
      },
      this.langue(destinataire),
    );
  }

  private langue(destinataire: { langue?: string | null }): string {
    const preferee = destinataire.langue?.trim();
    if (preferee) return resoudreLangueEmail(preferee);
    return resoudreLangueEmail(
      this.config.get<string>('EMAIL_LANGUE_DEFAUT') ?? undefined,
    );
  }

  private get appName(): string {
    return this.transport.appName;
  }

  private async programmer(
    cle: (typeof CleMessageEmail)[keyof typeof CleMessageEmail],
    destinataire: DestinataireEmail,
    contenu: MessageEmail,
    cleIdempotence: string,
  ): Promise<ResultatNotification> {
    const resultat = await this.file.programmer({
      cleIdempotence,
      typeEvenement: cle,
      destinataire: destinataire.email,
      langue: this.langue(destinataire),
      contenu,
    });

    return {
      programme: resultat.programme,
      nouveau: resultat.nouveau,
      envoye: resultat.envoye,
    };
  }
}

/** Emprunte court et stable, utilisé pour les clés d'idempotence. */
function hashDe(valeur: string): string {
  // FNV-1a 32 bits : suffisant pour discriminer une URL de jeton déjà aléatoire,
  // et surtout il n'expose aucun secret dans la clé.
  let hash = 0x811c9dc5;
  for (let i = 0; i < valeur.length; i += 1) {
    hash ^= valeur.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
