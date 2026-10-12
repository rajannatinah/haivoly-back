import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface ParametresEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  private get appName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Haivoly';
  }

  private get estProduction(): boolean {
    return (
      (this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
      'production'
    );
  }

  /** Transport réutilisé entre les envois. */
  private getTransporter(): Transporter | null {
    const host = this.configService.get<string>('SMTP_HOST');
    if (!host) return null;

    if (!this.transporter) {
      const port = Number(this.configService.get<string>('SMTP_PORT') ?? 587);
      const user = this.configService.get<string>('SMTP_USER');
      const pass = this.configService.get<string>('SMTP_PASSWORD');

      this.transporter = nodemailer.createTransport({
        host,
        port,
        // 465 = SMTP implicite TLS ; 587 = STARTTLS.
        secure: port === 465,
        ...(user && pass ? { auth: { user, pass } } : {}),
      });
    }

    return this.transporter;
  }

  /** Envoi réel ou journalisation selon la configuration. */
  async envoyer(email: ParametresEmail): Promise<void> {
    const transporter = this.getTransporter();

    if (!transporter) {
      if (this.estProduction) {
        this.logger.warn(
          'SMTP_HOST non configuré : l’e-mail n’a PAS été envoyé (production).',
        );
        throw new Error('Service e-mail non configuré');
      }

      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.log(`📧 [DEV] ${email.subject}`);
      this.logger.log(`   à : ${email.to}`);
      this.logger.log(`   ${email.text.split('\n').filter(Boolean).pop() ?? ''}`);
      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return;
    }

    const from =
      this.configService.get<string>('SMTP_FROM') ??
      `${this.appName} <noreply@haivoly.mg>`;

    await transporter.sendMail({ from, ...email });
    this.logger.log(`E-mail « ${email.subject} » envoyé à ${email.to}`);
  }

  /** Enveloppe HTML sobre, lisible sur un client mobile. */
  private enveloppe(titre: string, corpsHtml: string): string {
    return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f5f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#101828">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e6ece6">
      <h1 style="font-size:18px;margin:0 0 12px;color:#2E7D32">${this.appName}</h1>
      <h2 style="font-size:16px;margin:0 0 12px">${titre}</h2>
      ${corpsHtml}
      <p style="font-size:12px;color:#667085;margin-top:20px">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.
      </p>
    </div>
  </body>
</html>`;
  }

  private bouton(url: string, libelle: string): string {
    return `<p><a href="${url}" style="display:inline-block;background:#2E7D32;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${libelle}</a></p>`;
  }

  async envoyerVerificationEmail(
    email: string,
    verificationUrl: string,
    ttlMinutes: number,
  ): Promise<void> {
    await this.envoyer({
      to: email,
      subject: `Confirmez votre adresse e-mail — ${this.appName}`,
      text: `Bonjour,\n\nConfirmez votre adresse e-mail ${this.appName} en ouvrant ce lien (valable ${ttlMinutes} minutes) :\n\n${verificationUrl}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.`,
      html: this.enveloppe(
        'Confirmez votre adresse e-mail',
        `<p style="font-size:14px;line-height:1.6">Bonjour,</p>
         <p style="font-size:14px;line-height:1.6">Confirmez votre adresse pour activer votre compte ${this.appName}. Le lien expire dans <strong>${ttlMinutes} minutes</strong>.</p>
         ${this.bouton(verificationUrl, 'Confirmer mon adresse')}
         <p style="font-size:12px;color:#667085;word-break:break-all">Lien : ${verificationUrl}</p>`,
      ),
    });
  }

  async sendPasswordResetEmail(
    email: string,
    resetUrl: string,
  ): Promise<void> {
    await this.envoyer({
      to: email,
      subject: `Réinitialisez votre mot de passe — ${this.appName}`,
      text: `Bonjour,\n\nVous avez demandé la réinitialisation de votre mot de passe ${this.appName}. Ouvrez ce lien (valable 60 minutes) :\n\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
      html: this.enveloppe(
        'Réinitialisation du mot de passe',
        `<p style="font-size:14px;line-height:1.6">Bonjour,</p>
         <p style="font-size:14px;line-height:1.6">Vous avez demandé à réinitialiser votre mot de passe. Le lien expire dans <strong>60 minutes</strong>.</p>
         ${this.bouton(resetUrl, 'Choisir un nouveau mot de passe')}
         <p style="font-size:12px;color:#667085;word-break:break-all">Lien : ${resetUrl}</p>`,
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
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ??
      this.configService.get<string>('EXPO_PUBLIC_FRONTEND_URL') ??
      'exp://haivoly';

    const base = frontendUrl.replace(/\/$/, '');
    return `${base}/${page}?${param}=${encodeURIComponent(token)}`;
  }
}
