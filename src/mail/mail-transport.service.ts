import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface ParametresEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class ErreurSmtpIndisponible extends Error {
  readonly transient = true;

  constructor(message: string) {
    super(message);
    this.name = 'ErreurSmtpIndisponible';
  }
}

type MailConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  frontendUrl: string;
};

@Injectable()
export class MailTransportService implements OnModuleInit {
  private readonly logger = new Logger(MailTransportService.name);
  private transporter: Transporter | null = null;
  private configuration: MailConfiguration | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const production = this.isProduction;
    const frontendUrl = this.read('FRONTEND_URL');

    if (!frontendUrl && production) {
      throw new Error(
        'Configuration e-mail invalide : FRONTEND_URL doit désigner le site public de Haivoly.',
      );
    }

    const validFrontendUrl = this.validateFrontendUrl(
      frontendUrl ?? 'http://localhost:5173',
      production,
    );

    const host = this.read('MAIL_HOST', 'SMTP_HOST');
    const configuredPort = this.read('MAIL_PORT', 'SMTP_PORT');
    const portValue = configuredPort ?? '587';
    const secureValue = this.read('MAIL_SECURE');
    const user = this.read('MAIL_USER', 'SMTP_USER');
    const password = this.read('MAIL_PASSWORD', 'SMTP_PASSWORD');
    const from = this.read('MAIL_FROM', 'SMTP_FROM');
    const anyMailValue = [
      configuredPort,
      secureValue,
      user,
      password,
      from,
    ].some((value) => value !== undefined && value !== '');

    if (!host) {
      if (production || anyMailValue) {
        throw new Error(
          'Configuration SMTP incomplète : MAIL_HOST est obligatoire lorsque l’envoi d’e-mails est activé.',
        );
      }

      this.logger.warn(
        'SMTP non configuré : les e-mails seront conservés dans la file sans être transmis.',
      );
      this.configuration = null;
      return;
    }

    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        'Configuration SMTP invalide : MAIL_PORT doit être compris entre 1 et 65535.',
      );
    }

    const secure = this.parseSecure(secureValue, port);
    if ((port === 587 && secure) || (port === 465 && !secure)) {
      throw new Error(
        'Configuration SMTP incohérente : utilisez MAIL_SECURE=false avec le port 587 (STARTTLS) ou true avec le port 465.',
      );
    }
    if ((user && !password) || (!user && password)) {
      throw new Error(
        'Configuration SMTP incomplète : MAIL_USER et MAIL_PASSWORD doivent être renseignés ensemble.',
      );
    }
    if (!from || !this.mailbox(from)) {
      throw new Error(
        'Configuration SMTP invalide : MAIL_FROM doit contenir une adresse e-mail valide.',
      );
    }

    this.configuration = {
      host,
      port,
      secure,
      ...(user ? { user } : {}),
      ...(password ? { password } : {}),
      from,
      frontendUrl: validFrontendUrl,
    };

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(port === 587 ? { requireTLS: true } : {}),
      ...(user && password ? { auth: { user, pass: password } } : {}),
      connectionTimeout: this.lireEntier(
        'MAIL_CONNECTION_TIMEOUT_MS',
        10_000,
        1_000,
        120_000,
      ),
      greetingTimeout: this.lireEntier(
        'MAIL_GREETING_TIMEOUT_MS',
        10_000,
        1_000,
        120_000,
      ),
      socketTimeout: this.lireEntier(
        'MAIL_SOCKET_TIMEOUT_MS',
        20_000,
        1_000,
        300_000,
      ),
    });

    if (host.toLowerCase() === 'smtp.gmail.com' && user) {
      const sender = this.mailbox(from);
      if (sender && sender.toLowerCase() !== user.toLowerCase()) {
        this.logger.warn(
          'MAIL_FROM diffère de MAIL_USER. Gmail n’accepte cette adresse que si elle est déjà configurée comme alias autorisé dans le compte authentifié; SMTP ne permet pas de vérifier cet alias au démarrage.',
        );
      }
    }

    if (this.environment !== 'test') {
      try {
        await this.transporter.verify();
        this.logger.log(
          'Connexion SMTP vérifiée. Aucun e-mail de test n’a été envoyé.',
        );
      } catch (error) {
        const code = this.safeErrorCode(error);
        this.logger.error(`Vérification SMTP impossible (code=${code}).`);
        if (production) {
          throw new Error(
            'Impossible de vérifier le serveur SMTP. Vérifiez MAIL_HOST, MAIL_PORT, MAIL_SECURE et les identifiants, puis relancez le serveur.',
          );
        }
      }
    }
  }

  private get environment(): string {
    return (
      this.configService.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development'
    );
  }

  private get isProduction(): boolean {
    return this.environment === 'production';
  }

  /** Nom de l'application, rappelé dans l'objet et le pied de page des messages. */
  get appName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Haivoly';
  }

  /** Le transport SMTP est-il utilisable dans cet environnement ? */
  get estConfigure(): boolean {
    return this.transporter !== null && this.configuration !== null;
  }

  /** Tentatives internes au transport : absorbe les micro-coupures réseau. */
  get tentativeTransport(): number {
    return this.lireEntier('MAIL_TRANSPORT_TENTATIVES', 2, 1, 5);
  }

  /** MAIL_* est prioritaire; SMTP_* est conservé temporairement pour compatibilité. */
  private read(name: string, legacyName?: string): string | undefined {
    const value =
      this.configService.get<string>(name) ??
      (legacyName ? this.configService.get<string>(legacyName) : undefined);
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private lireEntier(
    nom: string,
    defaut: number,
    minimum: number,
    maximum: number,
  ): number {
    const brut = this.read(nom);
    if (brut === undefined) return defaut;
    const valeur = Number(brut);
    if (!Number.isInteger(valeur) || valeur < minimum || valeur > maximum) {
      throw new Error(
        `Configuration e-mail invalide : ${nom} doit être un entier entre ${minimum} et ${maximum}.`,
      );
    }
    return valeur;
  }

  private parseSecure(value: string | undefined, port: number): boolean {
    if (value === undefined) return port === 465;
    if (['true', '1'].includes(value.toLowerCase())) return true;
    if (['false', '0'].includes(value.toLowerCase())) return false;
    throw new Error(
      'Configuration SMTP invalide : MAIL_SECURE doit valoir true ou false.',
    );
  }

  private validateFrontendUrl(value: string, production: boolean): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        'Configuration invalide : FRONTEND_URL doit être une URL absolue valide.',
      );
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.host) {
      throw new Error(
        'Configuration invalide : FRONTEND_URL doit utiliser HTTP ou HTTPS.',
      );
    }
    if (production && url.protocol !== 'https:') {
      throw new Error(
        'Configuration invalide : FRONTEND_URL doit utiliser HTTPS en production.',
      );
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        'Configuration invalide : FRONTEND_URL ne doit contenir ni identifiants, ni paramètres, ni fragment.',
      );
    }
    return url.toString().replace(/\/$/, '');
  }

  private mailbox(from: string): string | null {
    const match = from.match(/<([^<>]+)>/);
    const address = (match?.[1] ?? from).trim();
    return /^[^\s@]+@[^\s@]+$/.test(address) ? address : null;
  }

  private safeErrorCode(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(code)
      ? code
      : 'UNKNOWN';
  }

  /** Remise au SMTP, avec reprise courte. Aucun contenu n'est journalisé. */
  async envoyer(email: ParametresEmail): Promise<void> {
    if (!this.transporter || !this.configuration) {
      throw new ErreurSmtpIndisponible(
        'Le service e-mail n’est pas configuré; le message n’a pas été envoyé.',
      );
    }

    const maximum = this.tentativeTransport;
    let dernierCode = 'UNKNOWN';

    for (let tentative = 1; tentative <= maximum; tentative += 1) {
      try {
        await this.transporter.sendMail({
          from: this.configuration.from,
          ...email,
        });
        this.logger.log('E-mail transmis au serveur SMTP.');
        return;
      } catch (erreur) {
        dernierCode = this.safeErrorCode(erreur);
        this.logger.warn(
          `Échec d’envoi SMTP (tentative ${tentative}/${maximum}, code=${dernierCode}).`,
        );
        if (tentative < maximum) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              this.lireEntier('MAIL_TRANSPORT_PALIERS_MS', 500, 0, 5_000) *
                tentative,
            ),
          );
        }
      }
    }

    // Le détail de la réponse SMTP (hôte, compte, message du serveur) n'est
    // jamais transmis à l'appelant ni journalisé : seule la nature du problème sort.
    throw new ErreurSmtpIndisponible(
      `Le service d'e-mail est temporairement indisponible (${dernierCode}).`,
    );
  }

  buildResetUrl(token: string): string {
    return this.buildUrl('reset-password', token, 'token');
  }

  buildVerificationUrl(token: string): string {
    return this.buildUrl('verify-email', token, 'token');
  }

  /** URL d'une page publique du web (activation de compte, mot de passe initial). */
  buildPageUrl(page: string, params: Record<string, string> = {}): string {
    const url = this.urlBase();
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix}/${page}`.replace(/^\/$/, `/${page}`);
    url.search = '';
    url.hash = '';
    for (const [cle, valeur] of Object.entries(params)) {
      url.searchParams.set(cle, valeur);
    }
    return url.toString();
  }

  private urlBase(): URL {
    const base =
      this.configuration?.frontendUrl ??
      this.validateFrontendUrl(
        this.read('FRONTEND_URL') ?? 'http://localhost:5173',
        this.isProduction,
      );
    return new URL(base);
  }

  private buildUrl(page: string, token: string, param: string): string {
    const url = this.urlBase();
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix}/${page}`.replace(/^\/$/, `/${page}`);
    url.search = '';
    url.hash = '';
    url.searchParams.set(param, token);
    return url.toString();
  }
}
