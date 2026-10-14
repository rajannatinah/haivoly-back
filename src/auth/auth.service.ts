import {
  BadRequestException,
  NotFoundException,
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
import { UsernameService } from '../users/username.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PasswordSetupToken } from './entities/password-setup-token.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { ApiException } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/error-codes';
import {
  normaliserEmail,
  politiqueEmail,
  validerEmailInscription,
} from '../common/utils/politique-email.util';
import { normaliserIdentifiantDeConnexion } from '../common/utils/username.util';
import { Role } from '../common/enums/domain.enums';
import { normaliserLangue } from '../common/utils/langue.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CreerCompteDto } from './dto/creer-compte.dto';
import {
  NotificationsMailService,
  type DestinataireEmail,
} from '../mail/notifications-mail.service';
import { MailTransportService } from '../mail/mail-transport.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

export interface PublicUtilisateur {
  id: string;
  nom: string;
  prenom: string | null;
  username: string;
  email: string;
  telephone: string | null;
  role: string;
  estVerifie: boolean;
  langue: string | null;
  /** Le titulaire doit encore remplacer le mot de passe provisoire. */
  motDePasseProvisoire: boolean;
  creeA: Date;
}

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_TTL_MIN = 60;
const SETUP_TOKEN_TTL_MIN = 24 * 60;
const VERIFICATION_TOKEN_TTL_MIN = 60;
const RESEND_COOLDOWN_MS = 60 * 1000;

const MESSAGE_EMAIL_JETABLE =
  'Les adresses e-mail temporaires ou jetables ne sont pas acceptées. Utilisez une adresse durable.';
const MESSAGE_EMAIL_INVALIDE = 'Adresse e-mail invalide.';
const MESSAGE_COMPTE_NON_VERIFIE =
  'Votre adresse e-mail n’a pas encore été confirmée. Consultez votre boîte de réception (et vos courriers indésirables) pour activer votre compte.';
const MESSAGE_MOT_DE_PASSE_PROVISOIRE =
  'Définissez votre mot de passe personnel avant de continuer : votre compte a été créé par un responsable.';

/** Règle de mot de passe appliquée à l'inscription comme à l'initialisation. */
export const POLITIQUE_MOT_DE_PASSE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Utilisateur)
    private readonly utilisateurs: Repository<Utilisateur>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokens: Repository<PasswordResetToken>,
    @InjectRepository(PasswordSetupToken)
    private readonly setupTokens: Repository<PasswordSetupToken>,
    private readonly jwtService: JwtService,
    private readonly notifications: NotificationsMailService,
    private readonly transport: MailTransportService,
    @InjectRepository(EmailVerificationToken)
    private readonly verificationTokens: Repository<EmailVerificationToken>,
    private readonly configService: ConfigService,
    private readonly usernames: UsernameService,
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

  /** Ne jamais renvoyer le hash du mot de passe, ni un jeton, ni un secret. */
  private toPublic(user: Utilisateur): PublicUtilisateur {
    return {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      username: user.username,
      email: user.email,
      telephone: user.telephone,
      role: user.role,
      estVerifie: user.estVerifie,
      langue: user.langue ?? null,
      motDePasseProvisoire: user.motDePasseProvisoire,
      creeA: user.creeA,
    };
  }

  // ─── Inscription publique ────────────────────────────────────

  async register(
    dto: RegisterDto,
  ): Promise<PublicUtilisateur & { message: string; emailEnvoye: boolean }> {
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

    const existant = await this.utilisateurs.findOne({ where: { email } });
    if (existant) {
      throw new ApiException(
        ErrorCode.USER_EMAIL_ALREADY_EXISTS,
        'Cet email est déjà utilisé',
        HttpStatus.CONFLICT,
      );
    }

    const verificationRequise = this.verificationRequise;

    const saved = await this.usernames.avecRepriseSurCollision(
      { nom: dto.nom, prenom: dto.prenom, email },
      async (username) => {
        const utilisateur = this.utilisateurs.create({
          nom: dto.nom.trim(),
          prenom: dto.prenom?.trim() ?? null,
          username,
          email,
          telephone: dto.telephone?.trim() ?? null,
          langue: dto.langue ? normaliserLangue(dto.langue) : null,
          role: dto.role ?? Role.PROPRIETAIRE,
          password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
          estVerifie: !verificationRequise,
          emailVerifieA: verificationRequise ? null : new Date(),
          motDePasseProvisoire: false,
        });

        return this.enregistrerUtilisateur(utilisateur);
      },
      dto.username ? { username: dto.username } : undefined,
    );

    this.logger.log(`[register] Compte créé (${saved.id}).`);

    const notification = verificationRequise
      ? await this.emettreVerification(saved, { inclureBienvenue: true })
      : await this.envoyerBienvenue(saved, null);

    return {
      ...this.toPublic(saved),
      message: !verificationRequise
        ? 'Compte créé. Vous pouvez vous connecter.'
        : notification.envoye
          ? 'Compte créé. Un message indiquant votre nom d’utilisateur et le lien de confirmation vous a été envoyé.'
          : 'Compte créé. Le message de confirmation est en cours d’envoi : vous pouvez le relancer depuis l’application.',
      emailEnvoye: notification.envoye,
    };
  }

  // ─── Connexion ───────────────────────────────────────────────

  async login(dto: LoginDto): Promise<{
    access_token: string;
    expires_at: string;
    utilisateur: PublicUtilisateur;
  }> {
    const saisi = dto.identifier ?? dto.email;
    if (!saisi) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    const identifiant = normaliserIdentifiantDeConnexion(saisi);
    const utilisateur = await this.utilisateurs.findOne(
      identifiant.type === 'email'
        ? { where: { email: identifiant.valeur } }
        : { where: { username: identifiant.valeur } },
    );

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

    if (utilisateur.motDePasseProvisoire) {
      throw new ApiException(
        ErrorCode.AUTH_PASSWORD_SETUP_REQUIRED,
        MESSAGE_MOT_DE_PASSE_PROVISOIRE,
        HttpStatus.FORBIDDEN,
      );
    }

    const access_token = await this.jwtService.signAsync({
      sub: utilisateur.id,
      email: utilisateur.email,
      role: utilisateur.role,
    });

    this.logger.log(`[login] ${utilisateur.id}`);

    // Le type est passé en argument générique explicite : `decode` renvoie
    // `T | null`, aucune assertion ne doit masquer un jeton illisible.
    const payload = this.jwtService.decode<{ exp?: number }>(access_token);

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

  // ─── Vérification d'adresse ──────────────────────────────────

  private async emettreVerification(
    utilisateur: Utilisateur,
    options: { inclureBienvenue?: boolean } = {},
  ): Promise<{ envoye: boolean; expireDansMinutes: number }> {
    const rawToken = crypto.randomBytes(32).toString('hex');

    // Invalide tout ancien jeton avant d'émettre le nouveau.
    await this.verificationTokens.update(
      { email: utilisateur.email, used: false },
      { used: true },
    );
    await this.verificationTokens.save(
      this.verificationTokens.create({
        email: utilisateur.email,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MIN * 60_000),
        utilisateurId: utilisateur.id,
      }),
    );

    const url = this.transport.buildVerificationUrl(rawToken);

    try {
      const destinataire = this.pourNotification(utilisateur);
      const resultat = options.inclureBienvenue
        ? await this.notifications.bienvenueAvecVerification(destinataire, {
            urlVerification: url,
            dureeMinutes: VERIFICATION_TOKEN_TTL_MIN,
          })
        : await this.notifications.rappelVerification(
            destinataire,
            url,
            VERIFICATION_TOKEN_TTL_MIN,
          );

      return {
        envoye: resultat.envoye,
        expireDansMinutes: VERIFICATION_TOKEN_TTL_MIN,
      };
    } catch {
      // Le jeton, l'adresse, l'URL et le détail SMTP ne sont jamais journalisés.
      this.logger.error('Programmation du message de confirmation impossible.');
      return { envoye: false, expireDansMinutes: VERIFICATION_TOKEN_TTL_MIN };
    }
  }

  private async envoyerBienvenue(
    utilisateur: Utilisateur,
    urlVerification: string | null,
  ): Promise<{ envoye: boolean }> {
    try {
      const resultat = await this.notifications.bienvenueAvecVerification(
        this.pourNotification(utilisateur),
        urlVerification ? { urlVerification } : {},
      );
      return { envoye: resultat.envoye };
    } catch {
      this.logger.error('Programmation du message de bienvenue impossible.');
      return { envoye: false };
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

  // ─── Mot de passe oublié ─────────────────────────────────────

  async forgotPassword(rawEmail: string) {
    const email = normaliserEmail(rawEmail);

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
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000),
        utilisateurId: utilisateur.id,
      }),
    );

    const resetUrl = this.transport.buildResetUrl(rawToken);

    try {
      await this.notifications.reinitialisationMotDePasse(
        this.pourNotification(utilisateur),
        {
          urlReinitialisation: resetUrl,
          dureeMinutes: RESET_TOKEN_TTL_MIN,
        },
      );
    } catch {
      // Ni l'adresse, ni le lien, ni le jeton, ni le détail SMTP en log.
      this.logger.error(
        'Programmation du message de réinitialisation impossible.',
      );
    }

    return genericResponse;
  }

  async resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    this.verifierCoupleDeMotsDePasse(newPassword, confirmPassword);

    const stored = await this.resetTokens.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!stored) {
      throw new ApiException(
        ErrorCode.AUTH_RESET_TOKEN_INVALID,
        'Le lien de réinitialisation est invalide.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (stored.used) {
      throw new ApiException(
        ErrorCode.AUTH_RESET_TOKEN_USED,
        'Ce lien a déjà été utilisé.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new ApiException(
        ErrorCode.AUTH_RESET_TOKEN_EXPIRED,
        'Le lien de réinitialisation a expiré. Veuillez refaire une demande.',
        HttpStatus.BAD_REQUEST,
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

  // ─── Comptes créés par un responsable ────────────────────────

  async creerCompteParResponsable(
    dto: CreerCompteDto,
    createur: AuthenticatedUser,
  ): Promise<{
    id: string;
    username: string;
    email: string;
    role: Role;
    message: string;
    activationProgrammee: boolean;
  }> {
    const email = normaliserEmail(dto.email);

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

    if ((await this.utilisateurs.findOne({ where: { email } })) !== null) {
      throw new ApiException(
        ErrorCode.USER_EMAIL_ALREADY_EXISTS,
        'Un compte existe déjà pour cette adresse e-mail.',
        HttpStatus.CONFLICT,
      );
    }

    // Un responsable ne crée que des comptes AGRICULTEUR rattachés à lui-même :
    // il ne peut pas s'inventer un pair ni un propriétaire.
    const role = Role.AGRICULTEUR;
    const verificationRequise = this.verificationRequise;

    const compte = await this.usernames.avecRepriseSurCollision(
      { nom: dto.nom, prenom: dto.prenom, email },
      async (username) => {
        const utilisateur = this.utilisateurs.create({
          nom: dto.nom.trim(),
          prenom: dto.prenom?.trim() ?? null,
          username,
          email,
          telephone: dto.telephone?.trim() ?? null,
          langue: dto.langue ? normaliserLangue(dto.langue) : null,
          role,
          proprietaireId: createur.id,
          // Secret inutilisable : seul le titulaire le définira.
          password: await bcrypt.hash(crypto.randomUUID(), BCRYPT_ROUNDS),
          estVerifie: !verificationRequise,
          emailVerifieA: verificationRequise ? null : new Date(),
          motDePasseProvisoire: true,
        });

        return this.enregistrerUtilisateur(utilisateur);
      },
      dto.username ? { username: dto.username } : undefined,
    );

    const activation = await this.programmerActivation(compte, {
      verificationRequise,
    });

    return {
      id: compte.id,
      username: compte.username,
      email: compte.email,
      role: compte.role,
      message: activation.programmee
        ? `Compte créé. Le nom d'utilisateur @${compte.username} et le lien d'activation ont été envoyés à l'adresse indiquée.`
        : `Compte créé avec le nom d'utilisateur @${compte.username}, mais l'envoi du message a échoué : relancez-le depuis la file de notification.`,
      activationProgrammee: activation.programmee,
    };
  }

  private async programmerActivation(
    compte: Utilisateur,
    options: { verificationRequise: boolean },
  ): Promise<{
    programmee: boolean;
    envoye: boolean;
    expireDansMinutes: number;
  }> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    await this.setupTokens.save(
      this.setupTokens.create({
        utilisateurId: compte.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MIN * 60_000),
        used: false,
      }),
    );

    const urlInitialisation = this.transport.buildPageUrl(
      'initialiser-mot-de-passe',
      {
        token: rawToken,
      },
    );

    let urlVerification: string | null = null;
    if (options.verificationRequise) {
      const brutVerification = crypto.randomBytes(32).toString('hex');
      await this.verificationTokens.save(
        this.verificationTokens.create({
          email: compte.email,
          tokenHash: this.hashToken(brutVerification),
          expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MIN * 60_000),
          utilisateurId: compte.id,
        }),
      );
      urlVerification = this.transport.buildVerificationUrl(brutVerification);
    }

    try {
      const resultat = await this.notifications.activationCompte(
        this.pourNotification(compte),
        {
          urlInitialisation,
          dureeMinutes: SETUP_TOKEN_TTL_MIN,
          urlVerification,
        },
      );

      return {
        programmee: resultat.programme,
        envoye: resultat.envoye,
        expireDansMinutes: SETUP_TOKEN_TTL_MIN,
      };
    } catch {
      this.logger.error('Programmation du message d’activation impossible.');
      return {
        programmee: false,
        envoye: false,
        expireDansMinutes: SETUP_TOKEN_TTL_MIN,
      };
    }
  }

  /** Contrôle du lien d'initialisation sans consommer le jeton. */
  async verifierJetonInitialisation(
    token: string,
  ): Promise<{ valide: boolean; username?: string; message?: string }> {
    const stocke = await this.setupTokens.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!stocke || stocke.used || stocke.expiresAt.getTime() < Date.now()) {
      return {
        valide: false,
        message:
          'Ce lien n’est plus valide. Demandez à votre responsable d’envoyer un nouveau lien.',
      };
    }

    const compte = await this.utilisateurs.findOne({
      where: { id: stocke.utilisateurId },
      select: ['id', 'username'],
    });

    return { valide: true, username: compte?.username };
  }

  /** Définition du premier mot de passe par le titulaire du compte. */
  async initialiserMotDePasse(
    token: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ message: string }> {
    this.verifierCoupleDeMotsDePasse(newPassword, confirmPassword);

    const stocke = await this.setupTokens.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!stocke) {
      throw new ApiException(
        ErrorCode.AUTH_SETUP_TOKEN_INVALID,
        'Ce lien d’activation est invalide.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (stocke.used) {
      throw new ApiException(
        ErrorCode.AUTH_SETUP_TOKEN_USED,
        'Ce lien d’activation a déjà été utilisé.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (stocke.expiresAt.getTime() < Date.now()) {
      throw new ApiException(
        ErrorCode.AUTH_SETUP_TOKEN_EXPIRED,
        'Ce lien d’activation a expiré. Demandez un nouvel envoi.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const compte = await this.utilisateurs.findOne({
      where: { id: stocke.utilisateurId },
    });

    if (!compte) {
      throw new ApiException(
        ErrorCode.AUTH_SETUP_TOKEN_INVALID,
        'Le compte associé à ce lien est introuvable.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.setupTokens.manager.transaction(async (manager) => {
      // Consommation conditionnelle : un second appel avec le même lien échoue.
      const consommation = await manager.update(
        PasswordSetupToken,
        { id: stocke.id, used: false },
        { used: true },
      );
      if (consommation?.affected === 0) {
        throw new ApiException(
          ErrorCode.AUTH_SETUP_TOKEN_USED,
          'Ce lien d’activation a déjà été utilisé.',
          HttpStatus.BAD_REQUEST,
        );
      }

      await manager.update(
        Utilisateur,
        { id: compte.id },
        {
          password: hash,
          motDePasseProvisoire: false,
          estVerifie: true,
          emailVerifieA: new Date(),
        },
      );

      // Tous les autres liens de ce compte sont invalidés, y compris les liens
      // de confirmation d'adresse : ils n'ont plus d'objet.
      await manager.update(
        PasswordSetupToken,
        { utilisateurId: compte.id, used: false },
        { used: true },
      );
      await manager.update(
        EmailVerificationToken,
        { utilisateurId: compte.id, used: false },
        { used: true },
      );
    });

    this.logger.log('[set-password] Mot de passe initial défini.');

    return {
      message:
        'Votre mot de passe est défini et votre adresse est confirmée. Vous pouvez maintenant vous connecter avec votre adresse e-mail ou votre nom d’utilisateur.',
    };
  }

  /** Relance le message d'activation d'un compte jamais initialisé. */
  async relancerActivation(
    utilisateurId: string,
  ): Promise<{ envoye: boolean }> {
    const compte = await this.utilisateurs.findOne({
      where: { id: utilisateurId },
    });
    if (!compte) {
      throw new NotFoundException('Compte introuvable');
    }

    // Un nouveau lien rend le précédent caduc : sans délai de rigueur, deux clics
    // consécutifs sur « renvoyer » supprimeraient le lien en cours d'utilisation.
    const dernier = await this.setupTokens.findOne({
      where: { utilisateurId },
      order: { createdAt: 'DESC' },
    });

    if (
      dernier?.createdAt &&
      Date.now() - dernier.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return { envoye: false };
    }

    const resultat = await this.programmerActivation(compte, {
      verificationRequise: this.verificationRequise && !compte.estVerifie,
    });

    return { envoye: resultat.envoye };
  }

  // ─── Divers ──────────────────────────────────────────────────

  private verifierCoupleDeMotsDePasse(
    newPassword: string,
    confirmPassword: string,
  ): void {
    if (newPassword !== confirmPassword) {
      throw new ApiException(
        ErrorCode.VALIDATION_INVALID_VALUE,
        'Les mots de passe ne correspondent pas',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!POLITIQUE_MOT_DE_PASSE.test(newPassword)) {
      throw new ApiException(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async enregistrerUtilisateur(
    utilisateur: Utilisateur,
  ): Promise<Utilisateur> {
    try {
      return await this.utilisateurs.save(utilisateur);
    } catch (erreur) {
      const detail = erreur as { code?: string; constraint?: string } | null;

      if (
        detail?.code === '23505' &&
        (detail.constraint ?? '').includes('email')
      ) {
        throw new ApiException(
          ErrorCode.USER_EMAIL_ALREADY_EXISTS,
          'Un compte existe déjà pour cette adresse e-mail.',
          HttpStatus.CONFLICT,
        );
      }

      // Conflit sur `username` : remonté tel quel, `avecRepriseSurCollision`
      // le reconnaît et rejoue la génération.
      throw erreur;
    }
  }

  private pourNotification(user: Utilisateur): DestinataireEmail {
    return {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom ?? null,
      email: user.email,
      username: user.username,
      langue: user.langue ?? null,
    };
  }

  /** Purge des tokens expirés — appelée par la maintenance planifiée du module. */
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

  /** Purge des liens d'activation périmés ou consommés. */
  async purgeExpiredSetupTokens(): Promise<number> {
    const result = await this.setupTokens
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" < :now', { now: new Date() })
      .orWhere('"used" = true AND "expiresAt" < :now', { now: new Date() })
      .execute();

    return result.affected ?? 0;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
