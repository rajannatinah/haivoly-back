import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';

import { Utilisateur } from '../users/entities/utilisateur.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { ApiException } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/error-codes';
import {
  normaliserEmail,
  politiqueEmail,
  validerEmailInscription,
} from '../common/utils/politique-email.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MailService } from './mail.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

export interface PublicUtilisateur {
  id: string;
  nom: string;
  prenom: string | null;
  email: string;
  telephone: string | null;
  role: string;
  estVerifie: boolean;
  creeA: Date;
}

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure
const VERIFICATION_TOKEN_TTL_MIN = 60;
const VERIFICATION_TOKEN_TTL_MS = VERIFICATION_TOKEN_TTL_MIN * 60 * 1000;
/** Délai minimal entre deux renvois de l'e-mail de vérification. */
const RESEND_COOLDOWN_MS = 60 * 1000;

const MESSAGE_EMAIL_JETABLE =
  'Les adresses e-mail temporaires ou jetables ne sont pas acceptées. Utilisez une adresse durable.';
const MESSAGE_EMAIL_INVALIDE = 'Adresse e-mail invalide.';
const MESSAGE_COMPTE_NON_VERIFIE =
  'Votre adresse e-mail n’a pas encore été confirmée. Consultez votre boîte de réception (et vos courriers indésirables) pour activer votre compte.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokens: Repository<PasswordResetToken>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @InjectRepository(EmailVerificationToken)
    private readonly verificationTokens: Repository<EmailVerificationToken>,
    private readonly configService: ConfigService,
  ) {}

  /** Politique e-mail configurable (voir politique-email.util). */
  private get politique() {
    return politiqueEmail({
      EMAIL_BLOQUER_JETABLES: this.configService.get<string>(
        'EMAIL_BLOQUER_JETABLES',
      ),
      EMAIL_DOMAINES_JETABLES_SUPPLEMENTAIRES: this.configService.get<string>(
        'EMAIL_DOMAINES_JETABLES_SUPPLEMENTAIRES',
      ),
      EMAIL_DOMAINES_JETABLES_IGNORES: this.configService.get<string>(
        'EMAIL_DOMAINES_JETABLES_IGNORES',
      ),
    });
  }

  private get verificationRequise(): boolean {
    const brut = this.configService.get<string>('EMAIL_VERIFICATION_REQUISE');
    return brut === undefined ? true : brut.toLowerCase() !== 'false';
  }

  /** Ne jamais renvoyer le hash du mot de passe. */
  private toPublic(user: Utilisateur): PublicUtilisateur {
    return {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      telephone: user.telephone,
      role: user.role,
      estVerifie: user.estVerifie,
      creeA: user.creeA,
    };
  }

  async register(
    dto: RegisterDto,
  ): Promise<PublicUtilisateur & { message: string; emailEnvoye?: boolean }> {
    const email = normaliserEmail(dto.email);

    // Le backend est la source de vérité : la vérification frontend n'est
    // qu'un confort d'affichage.
    const verdict = validerEmailInscription(email, this.politique);

    if (verdict === 'EMAIL_INVALIDE') {
      throw new ApiException(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        MESSAGE_EMAIL_INVALIDE,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (verdict === 'EMAIL_JETABLE') {
      throw new ApiException(
        ErrorCode.AUTH_EMAIL_DISPOSABLE,
        MESSAGE_EMAIL_JETABLE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.utilisateurs.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Cet email est déjà utilisé');
    }

    const verificationRequise = this.verificationRequise;
    const utilisateur = this.utilisateurs.create({
      nom: dto.nom.trim(),
      prenom: dto.prenom?.trim() ?? null,
      email,
      telephone: dto.telephone?.trim() ?? null,
      password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      estVerifie: !verificationRequise,
      emailVerifieA: verificationRequise ? null : new Date(),
    });

    const saved = await this.utilisateurs.save(utilisateur);
    this.logger.log(`[register] Compte créé (${saved.id}).`);

    const emailEnvoye = verificationRequise
      ? await this.emettreVerification(saved)
      : false;

    return {
      ...this.toPublic(saved),
      message: !verificationRequise
        ? 'Compte créé. Vous pouvez vous connecter.'
        : emailEnvoye
          ? 'Compte créé. Consultez votre boîte de réception pour confirmer votre adresse e-mail.'
          : 'Compte créé, mais le message de confirmation n’a pas pu être transmis. Vous pourrez demander un nouvel envoi.',
      ...(verificationRequise ? { emailEnvoye } : {}),
    };
  }

  /** Crée un jeton aléatoire, ne conserve que son hash et transmet le lien. */
  private async emettreVerification(
    utilisateur: Utilisateur,
  ): Promise<boolean> {
    const rawToken = crypto.randomBytes(32).toString('hex');

    try {
      // Invalide tout ancien jeton avant d'émettre le nouveau.
      await this.verificationTokens.update(
        { email: utilisateur.email, used: false },
        { used: true },
      );
      await this.verificationTokens.save(
        this.verificationTokens.create({
          email: utilisateur.email,
          tokenHash: this.hashToken(rawToken),
          expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
          utilisateurId: utilisateur.id,
        }),
      );

      const url = this.mailService.buildVerificationUrl(rawToken);
      await this.mailService.envoyerVerificationEmail(
        utilisateur.email,
        url,
        VERIFICATION_TOKEN_TTL_MIN,
      );
      return true;
    } catch {
      // Le jeton, l'adresse, l'URL et les détails SMTP ne sont jamais journalisés.
      this.logger.error('Émission du message de confirmation impossible.');
      return false;
    }
  }

  /** Confirme la possession de l'adresse à partir du jeton reçu. */
  async verifyEmail(token: string): Promise<{ message: string }> {
    const stocke = await this.verificationTokens.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!stocke) {
      throw new ApiException(
        ErrorCode.AUTH_VERIFICATION_INVALID,
        'Ce lien de vérification est invalide.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (stocke.used) {
      throw new ApiException(
        ErrorCode.AUTH_VERIFICATION_USED,
        'Ce lien de vérification a déjà été utilisé.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (stocke.expiresAt.getTime() < Date.now()) {
      throw new ApiException(
        ErrorCode.AUTH_VERIFICATION_EXPIRED,
        'Ce lien de vérification a expiré. Demandez un nouvel envoi.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const utilisateur = await this.utilisateurs.findOne({
      where: { email: stocke.email },
    });

    if (!utilisateur) {
      throw new ApiException(
        ErrorCode.AUTH_VERIFICATION_INVALID,
        'Compte associé introuvable.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.verificationTokens.manager.transaction(async (manager) => {
      // Consommation conditionnelle : deux confirmations concurrentes ne
      // peuvent pas utiliser le même jeton deux fois.
      const consommation = await manager.update(
        EmailVerificationToken,
        { id: stocke.id, used: false },
        { used: true },
      );
      if (consommation?.affected === 0) {
        throw new ApiException(
          ErrorCode.AUTH_VERIFICATION_USED,
          'Ce lien de vérification a déjà été utilisé.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const miseAJour = await manager.update(
        Utilisateur,
        { id: utilisateur.id },
        { estVerifie: true, emailVerifieA: new Date() },
      );
      if (miseAJour?.affected === 0) {
        throw new ApiException(
          ErrorCode.AUTH_VERIFICATION_INVALID,
          'Ce lien de vérification est invalide.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Invalidation de tous les autres jetons de cette adresse.
      await manager.update(
        EmailVerificationToken,
        { email: stocke.email, used: false },
        { used: true },
      );
    });

    this.logger.log('[verify-email] Confirmation d’adresse terminée.');

    return {
      message:
        'Votre adresse e-mail est confirmée. Vous pouvez maintenant vous connecter.',
    };
  }

  /**
   * Renvoie l'e-mail de vérification.
   *
   * Réponse identique que le compte existe ou non (anti-énumération), avec un
   * délai minimal entre deux envois pour la même adresse.
   */
  async resendVerification(rawEmail: string): Promise<{ message: string }> {
    const email = normaliserEmail(rawEmail);
    // Réponse strictement identique pour une adresse inconnue, déjà confirmée,
    // limitée par le délai ou éligible à un nouvel envoi.
    const generique = {
      message:
        'Si un compte non confirmé est associé à cette adresse, un message de confirmation sera envoyé.',
    };

    const utilisateur = await this.utilisateurs.findOne({ where: { email } });
    if (!utilisateur || utilisateur.estVerifie) return generique;

    const dernier = await this.verificationTokens.findOne({
      where: { email },
      order: { createdAt: 'DESC' },
    });

    // Le délai par adresse ne renvoie pas de 429 : cela révélerait l'existence
    // d'un compte. Le contrôleur applique en parallèle une limite uniforme par IP.
    if (
      dernier?.createdAt &&
      Date.now() - dernier.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return generique;
    }

    await this.emettreVerification(utilisateur);
    return generique;
  }

  async login(dto: LoginDto): Promise<{
    access_token: string;
    expires_at: string;
    utilisateur: PublicUtilisateur;
  }> {
    const email = dto.email.toLowerCase().trim();

    const utilisateur = await this.utilisateurs.findOne({ where: { email } });
    if (!utilisateur) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    const passwordValid = await bcrypt.compare(
      dto.password,
      utilisateur.password,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    // Vérifié après le contrôle du mot de passe : on ne révèle pas l'état de
    // vérification d'un compte dont on ne connaît pas le secret.
    if (this.verificationRequise && !utilisateur.estVerifie) {
      throw new ApiException(
        ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
        MESSAGE_COMPTE_NON_VERIFIE,
        HttpStatus.FORBIDDEN,
      );
    }

    const access_token = await this.jwtService.signAsync({
      sub: utilisateur.id,
      email: utilisateur.email,
      role: utilisateur.role,
    });

    this.logger.log(`[login] ${utilisateur.id}`);

    const payload = this.jwtService.decode(access_token) as
      | { exp?: number }
      | null;

    if (!payload?.exp || !Number.isFinite(payload.exp)) {
      throw new InternalServerErrorException(
        'La configuration de durée de session est invalide.',
      );
    }

    return {
      access_token,
      expires_at: new Date(payload.exp * 1000).toISOString(),
      utilisateur: this.toPublic(utilisateur),
    };
  }

  logout(user: AuthenticatedUser): { message: string } {
    this.logger.log(`[logout] ${user.id}`);
    return { message: 'Déconnexion réussie' };
  }

  async me(user: AuthenticatedUser): Promise<PublicUtilisateur> {
    const utilisateur = await this.utilisateurs.findOne({
      where: { id: user.id },
    });

    if (!utilisateur) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    return this.toPublic(utilisateur);
  }

  async forgotPassword(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();

    // Réponse identique quel que soit le résultat (anti-énumération)
    const genericResponse = {
      message:
        'Si un compte est associé à cette adresse, un email de réinitialisation a été envoyé. Pensez à vérifier vos courriers indésirables.',
    };

    const utilisateur = await this.utilisateurs.findOne({ where: { email } });

    if (!utilisateur) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return genericResponse;
    }

    // Invalider les anciens tokens non utilisés
    await this.resetTokens.update({ email, used: false }, { used: true });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    await this.resetTokens.save(
      this.resetTokens.create({
        email,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        utilisateurId: utilisateur.id,
      }),
    );

    const resetUrl = this.mailService.buildResetUrl(rawToken);

    try {
      await this.mailService.sendPasswordResetEmail(email, resetUrl);
    } catch {
      // Ne pas écrire l'adresse, le lien, le jeton ou le détail SMTP dans les logs.
      this.logger.error('Émission du message de réinitialisation impossible.');
    }

    return genericResponse;
  }

  async resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Les mots de passe ne correspondent pas');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caractères',
      );
    }

    const stored = await this.resetTokens.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!stored) {
      throw new BadRequestException('Le lien de réinitialisation est invalide');
    }

    if (stored.used) {
      throw new BadRequestException('Ce lien a déjà été utilisé');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Le lien de réinitialisation a expiré. Veuillez refaire une demande.',
      );
    }

    const utilisateur = await this.utilisateurs.findOne({
      where: { email: stored.email },
    });

    if (!utilisateur) {
      throw new BadRequestException('Utilisateur associé introuvable');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Transaction : mot de passe + invalidation de TOUS les tokens
    await this.resetTokens.manager.transaction(async (manager) => {
      await manager.update(
        Utilisateur,
        { id: utilisateur.id },
        { password: hashedPassword },
      );

      await manager.update(
        PasswordResetToken,
        { email: stored.email, used: false },
        { used: true },
      );
    });

    this.logger.log('[reset-password] Mot de passe réinitialisé.');

    return {
      message:
        'Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.',
    };
  }

  /** Purge des tokens expirés — appelée par la tâche planifiée du module. */
  async purgeExpiredResetTokens(): Promise<number> {
    const result = await this.resetTokens
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" < :now', { now: new Date() })
      .orWhere('"used" = true AND "expiresAt" < :now', { now: new Date() })
      .execute();

    return result.affected ?? 0;
  }

  /** Purge des jetons de vérification périmés. */
  async purgeExpiredVerificationTokens(): Promise<number> {
    const result = await this.verificationTokens
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" < :now', { now: new Date() })
      .execute();

    return result.affected ?? 0;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
