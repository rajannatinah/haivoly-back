import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import {
  EmailOutbox,
  nouveauIdEmailOutbox,
  StatutEnvoiEmail,
} from './mail-outbox.entity';
import {
  ErreurSmtpIndisponible,
  MailTransportService,
} from './mail-transport.service';
import type { MessageEmail, MessageEmailCle } from './mail-modeles';

export interface OrdreEnvoi {
  /** Clé d'idempotence : deux ordres identiques ne produisent qu'un message. */
  cleIdempotence: string;
  typeEvenement: MessageEmailCle;
  destinataire: string;
  langue?: string | null;
  contenu: MessageEmail;
}

export interface ResultatProgrammation {
  programme: boolean;
  /** `false` quand un ordre identique était déjà en file (renvoi évité). */
  nouveau: boolean;
  envoye: boolean;
}

@Injectable()
export class MailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailOutboxService.name);
  private temporisateur: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(EmailOutbox)
    private readonly file: Repository<EmailOutbox>,
    private readonly transport: MailTransportService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalle = this.intervalleMs;
    if (this.environment === 'test' || intervalle <= 0) return;

    this.temporisateur = setInterval(() => {
      void this.traiterEnAttente().catch(() => {
        this.logger.error(
          'Échec inattendu du traitement de la file d’e-mails.',
        );
      });
    }, intervalle);
    // Ne retient pas le processus éteint (important pour les tests et le CLI).
    this.temporisateur.unref?.();
  }

  onModuleDestroy(): void {
    if (this.temporisateur) clearInterval(this.temporisateur);
    this.temporisateur = null;
  }

  private get intervalleMs(): number {
    return this.entier('MAIL_OUTBOX_INTERVALLE_MS', 60_000, 0, 3_600_000);
  }

  private get maxTentatives(): number {
    return this.entier('MAIL_MAX_TENTATIVES', 5, 1, 20);
  }

  private get palierMs(): number {
    return this.entier('MAIL_REPRISE_PALIER_MS', 60_000, 1_000, 3_600_000);
  }

  private get lot(): number {
    return this.entier('MAIL_OUTBOX_LOT', 20, 1, 200);
  }

  private get environment(): string {
    return (
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development'
    );
  }

  private entier(
    nom: string,
    defaut: number,
    min: number,
    max: number,
  ): number {
    const brut = this.config.get<string>(nom) ?? process.env[nom];
    if (brut === undefined || String(brut).trim() === '') return defaut;
    const valeur = Number(brut);
    if (!Number.isInteger(valeur) || valeur < min || valeur > max) {
      throw new Error(
        `Configuration e-mail invalide : ${nom} doit être un entier entre ${min} et ${max}.`,
      );
    }
    return valeur;
  }

  async programmer(ordre: OrdreEnvoi): Promise<ResultatProgrammation> {
    const existant = await this.file.findOne({
      where: { cleIdempotence: ordre.cleIdempotence },
      select: ['id', 'statut'],
    });

    if (existant) {
      return { programme: true, nouveau: false, envoye: false };
    }

    const ligne = this.file.create({
      id: nouveauIdEmailOutbox(),
      cleIdempotence: ordre.cleIdempotence,
      typeEvenement: ordre.typeEvenement,
      destinataire: ordre.destinataire,
      langue: ordre.langue ?? null,
      sujet: ordre.contenu.sujet,
      texte: ordre.contenu.texte,
      html: ordre.contenu.html,
      statut: StatutEnvoiEmail.EN_ATTENTE,
      tentatives: 0,
      prochainEnvoiA: new Date(),
      envoyeA: null,
      dernierCodeErreur: null,
    });

    try {
      await this.file.save(ligne);
    } catch (erreur) {
      // Course entre deux requêtes identiques : l'index unique arbitre, on ne
      // double jamais l'envoi.
      if (estConflitUnique(erreur)) {
        return { programme: true, nouveau: false, envoye: false };
      }
      throw erreur;
    }

    const envoye = await this.envoyerImmediatement(ligne.id);
    return { programme: true, nouveau: true, envoye };
  }

  /** Tentative immédiate, sans bloquer l'appelant plus que le timeout SMTP. */
  private async envoyerImmediatement(id: string): Promise<boolean> {
    if (!this.transport.estConfigure) return false;

    const revendique = await this.file
      .createQueryBuilder()
      .update(EmailOutbox)
      .set({ statut: StatutEnvoiEmail.EN_COURS })
      .where('id = :id', { id })
      .andWhere('statut = :statut', { statut: StatutEnvoiEmail.EN_ATTENTE })
      .execute();

    if (!revendique.affected) return false;

    const ligne = await this.file.findOne({ where: { id } });
    if (!ligne) return false;

    return this.traiterLigne(ligne);
  }

  /** Traite les messages dont l'heure d'envoi est atteinte. */
  async traiterEnAttente(
    limit = this.lot,
  ): Promise<{ traites: number; envoyes: number }> {
    if (!this.transport.estConfigure) {
      return { traites: 0, envoyes: 0 };
    }

    const enAttente = await this.file.find({
      where: {
        statut: StatutEnvoiEmail.EN_ATTENTE,
        prochainEnvoiA: LessThanOrEqual(new Date()),
      },
      order: { prochainEnvoiA: 'ASC' },
      take: Math.max(1, Math.min(limit, this.lot)),
    });

    let envoyes = 0;

    for (const candidat of enAttente) {
      // Revendication conditionnelle : deux instances ne peuvent pas envoyer la
      // même ligne, même si elles la lisent toutes les deux.
      const revendication = await this.file
        .createQueryBuilder()
        .update(EmailOutbox)
        .set({ statut: StatutEnvoiEmail.EN_COURS })
        .where('id = :id', { id: candidat.id })
        .andWhere('statut = :statut', { statut: StatutEnvoiEmail.EN_ATTENTE })
        .execute();

      if (!revendication.affected) continue;

      const ligne = await this.file.findOne({ where: { id: candidat.id } });
      if (!ligne) continue;

      if (await this.traiterLigne(ligne)) envoyes += 1;
    }

    return { traites: enAttente.length, envoyes };
  }

  private async traiterLigne(ligne: EmailOutbox): Promise<boolean> {
    try {
      await this.transport.envoyer({
        to: ligne.destinataire,
        subject: ligne.sujet,
        text: ligne.texte,
        html: ligne.html,
      });

      await this.file.update(
        { id: ligne.id },
        {
          statut: StatutEnvoiEmail.ENVOYE,
          envoyeA: new Date(),
          dernierCodeErreur: null,
        },
      );
      return true;
    } catch (erreur) {
      const tentatives = ligne.tentatives + 1;
      const epuise = tentatives >= this.maxTentatives;
      const code = estErreurSmtp(erreur)
        ? 'SMTP_INDISPONIBLE'
        : 'ENVOI_IMPOSSIBLE';

      await this.file.update(
        { id: ligne.id },
        {
          statut: epuise ? StatutEnvoiEmail.ECHEC : StatutEnvoiEmail.EN_ATTENTE,
          tentatives,
          dernierCodeErreur: code,
          prochainEnvoiA: new Date(
            Date.now() + this.palierMs * 2 ** Math.min(tentatives, 6),
          ),
        },
      );

      // Le contenu du message et les jetons ne sont jamais journalisés.
      this.logger.warn(
        epuise
          ? `E-mail abandonné après ${tentatives} tentatives (type=${ligne.typeEvenement}, code=${code}).`
          : `E-mail en attente de relance (type=${ligne.typeEvenement}, tentative=${tentatives}, code=${code}).`,
      );
      return false;
    }
  }

  /** Relance manuelle d'un message en échec (support, pas d'API publique). */
  async relancer(cleIdempotence: string): Promise<boolean> {
    const resultat = await this.file.update(
      { cleIdempotence, statut: StatutEnvoiEmail.ECHEC },
      {
        statut: StatutEnvoiEmail.EN_ATTENTE,
        tentatives: 0,
        prochainEnvoiA: new Date(),
      },
    );
    return (resultat.affected ?? 0) > 0;
  }

  /** Purge des messages livrés pour ne pas conserver de contenu indéfiniment. */
  async purgerMessagesLivres(avantHeures = 24): Promise<number> {
    const limite = new Date(Date.now() - avantHeures * 3_600_1000);
    const resultat = await this.file
      .createQueryBuilder()
      .delete()
      .where('statut = :statut', { statut: StatutEnvoiEmail.ENVOYE })
      .andWhere('envoyeA < :limite', { limite })
      .execute();
    return resultat.affected ?? 0;
  }

  /** État de la file — utilisé par l'endpoint de santé, sans contenu ni adresse. */
  async etat(): Promise<{
    enAttente: number;
    echecs: number;
    envoyes: number;
    transportConfigure: boolean;
  }> {
    const [enAttente, echecs, envoyes] = await Promise.all([
      this.file.count({ where: { statut: StatutEnvoiEmail.EN_ATTENTE } }),
      this.file.count({ where: { statut: StatutEnvoiEmail.ECHEC } }),
      this.file.count({ where: { statut: StatutEnvoiEmail.ENVOYE } }),
    ]);

    return {
      enAttente,
      echecs,
      envoyes,
      transportConfigure: this.transport.estConfigure,
    };
  }
}

function estErreurSmtp(erreur: unknown): boolean {
  return erreur instanceof ErreurSmtpIndisponible;
}

function estConflitUnique(erreur: unknown): boolean {
  const code = (erreur as { code?: string } | null)?.code;
  return code === '23505';
}
