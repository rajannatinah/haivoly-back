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
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
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
    const anyMailValue = [configuredPort, secureValue, user, password, from].some(
      (value) => value !== undefined && value !== '',
    );

    if (!host) {
      if (production || anyMailValue) {
        throw new Error(
          'Configuration SMTP incomplète : MAIL_HOST est obligatoire lorsque l’envoi d’e-mails est activé.',
        );
      }

      this.logger.warn(
        'SMTP non configuré : les e-mails ne seront pas envoyés dans cet environnement.',
      );
      this.configuration = null;
      return;
    }

    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Configuration SMTP invalide : MAIL_PORT doit être compris entre 1 et 65535.');
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
      throw new Error('Configuration SMTP invalide : MAIL_FROM doit contenir une adresse e-mail valide.');
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
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    if (host.toLowerCase() === 'smtp.gmail.com' && user) {
      const sender = this.mailbox(from);
      if (sender && sender.toLowerCase() !== user.toLowerCase()) {
        this.logger.warn(
          'MAIL_FROM diffère de MAIL_USER. Gmail n’accepte cette adresse que si elle est déjà configurée comme alias autorisé dans le compte authentifié; SMTP ne permet pas de vérifier cet alias au démarrage.',
        );
      }
    }

    // La validation SMTP teste la connexion et l’authentification, pas
    // l’autorisation de l’adresse From ni la livraison finale chez le destinataire.
    // Aucun envoi de message de test n’est effectué au démarrage.
    if (this.environment !== 'test') {
      try {
        await this.transporter.verify();
        this.logger.log('Connexion SMTP vérifiée. Aucun e-mail de test n’a été envoyé.');
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
    return this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
  }

  private get isProduction(): boolean {
    return this.environment === 'production';
  }

  private get appName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Haivoly';
  }

  /** MAIL_* est prioritaire; SMTP_* est conservé temporairement pour compatibilité. */
  private read(name: string, legacyName?: string): string | undefined {
    const value = this.configService.get<string>(name) ??
      (legacyName ? this.configService.get<string>(legacyName) : undefined);
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private parseSecure(value: string | undefined, port: number): boolean {
    if (value === undefined) return port === 465;
    if (['true', '1'].includes(value.toLowerCase())) return true;
    if (['false', '0'].includes(value.toLowerCase())) return false;
    throw new Error('Configuration SMTP invalide : MAIL_SECURE doit valoir true ou false.');
  }

  private validateFrontendUrl(value: string, production: boolean): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Configuration invalide : FRONTEND_URL doit être une URL absolue valide.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.host) {
      throw new Error('Configuration invalide : FRONTEND_URL doit utiliser HTTP ou HTTPS.');
    }
    if (production && url.protocol !== 'https:') {
      throw new Error('Configuration invalide : FRONTEND_URL doit utiliser HTTPS en production.');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('Configuration invalide : FRONTEND_URL ne doit contenir ni identifiants, ni paramètres, ni fragment.');
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

  /** Envoi réel uniquement : aucun lien/jeton n’est journalisé en mode local. */
  async envoyer(email: ParametresEmail): Promise<void> {
    if (!this.transporter || !this.configuration) {
      throw new Error('Le service e-mail n’est pas configuré; le message n’a pas été envoyé.');
    }

    try {
      await this.transporter.sendMail({
        from: this.configuration.from,
        ...email,
      });
      this.logger.log('E-mail transmis au serveur SMTP.');
    } catch (error) {
      this.logger.error(`Échec de l’envoi SMTP (code=${this.safeErrorCode(error)}).`);
      throw new Error('Le service e-mail est temporairement indisponible.');
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[character] ?? character;
    });
  }

  /** Enveloppe HTML sobre, lisible sur un client mobile. */
  private enveloppe(titre: string, corpsHtml: string): string {
    const appName = this.escapeHtml(this.appName);
    const titreSecurise = this.escapeHtml(titre);
    return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f5f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#101828">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e6ece6">
      <h1 style="font-size:18px;margin:0 0 12px;color:#2E7D32">${appName}</h1>
      <h2 style="font-size:16px;margin:0 0 12px">${titreSecurise}</h2>
      ${corpsHtml}
      <p style="font-size:12px;color:#667085;margin-top:20px">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.
      </p>
    </div>
  </body>
</html>`;
  }

  private bouton(url: string, libelle: string): string {
    const safeUrl = this.escapeHtml(url);
    const safeLabel = this.escapeHtml(libelle);
    return `<p><a href="${safeUrl}" style="display:inline-block;background:#2E7D32;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${safeLabel}</a></p>`;
  }

  async envoyerVerificationEmail(
    email: string,
    verificationUrl: string,
    ttlMinutes: number,
  ): Promise<void> {
    const appName = this.appName;
    await this.envoyer({
      to: email,
      subject: `Confirmez votre adresse e-mail — ${appName}`,
      text: `Bonjour,\n\nConfirmez votre adresse e-mail ${appName} en ouvrant ce lien (valable ${ttlMinutes} minutes) :\n\n${verificationUrl}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.`,
      html: this.enveloppe(
        'Confirmez votre adresse e-mail',
        `<p style="font-size:14px;line-height:1.6">Bonjour,</p>
         <p style="font-size:14px;line-height:1.6">Confirmez votre adresse pour activer votre compte ${this.escapeHtml(appName)}. Le lien expire dans <strong>${ttlMinutes} minutes</strong>.</p>
         ${this.bouton(verificationUrl, 'Confirmer mon adresse')}
         <p style="font-size:12px;color:#667085;word-break:break-all">Lien : ${this.escapeHtml(verificationUrl)}</p>`,
      ),
    });
  }

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    await this.envoyer({
      to: email,
      subject: `Réinitialisez votre mot de passe — ${this.appName}`,
      text: `Bonjour,\n\nVous avez demandé la réinitialisation de votre mot de passe ${this.appName}. Ouvrez ce lien (valable 60 minutes) :\n\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
      html: this.enveloppe(
        'Réinitialisation du mot de passe',
        `<p style="font-size:14px;line-height:1.6">Bonjour,</p>
         <p style="font-size:14px;line-height:1.6">Vous avez demandé à réinitialiser votre mot de passe. Le lien expire dans <strong>60 minutes</strong>.</p>
         ${this.bouton(resetUrl, 'Choisir un nouveau mot de passe')}
         <p style="font-size:12px;color:#667085;word-break:break-all">Lien : ${this.escapeHtml(resetUrl)}</p>`,
      ),
    });
  }

  buildResetUrl(token: string): string {
    return this.buildUrl('reset-password', token, 'token');
  }

  buildVerificationUrl(token: string): string {
    return this.buildUrl('verify-email', token, 'token');
  }

  private buildUrl(page: string, token: string, param: string): string {
    const base = this.configuration?.frontendUrl ?? this.validateFrontendUrl(
      this.read('FRONTEND_URL') ?? 'http://localhost:5173',
      this.isProduction,
    );
    const url = new URL(base);
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix}/${page}`.replace(/^\/$/, `/${page}`);
    url.search = '';
    url.hash = '';
    url.searchParams.set(param, token);
    return url.toString();
  }
}
