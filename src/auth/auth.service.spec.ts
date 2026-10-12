import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { createMockRepo } from '../test-utils/repo.mock';
import { MailService } from './mail.service';
import { Utilisateur } from '../users/entities/utilisateur.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { ApiException } from '../common/errors/api-error';
import { Role } from '../common/enums/domain.enums';

describe('AuthService — sécurité', () => {
  let service: AuthService;
  let utilisateurs: ReturnType<typeof createMockRepo>;
  let resetTokens: ReturnType<typeof createMockRepo>;
  let verificationTokens: ReturnType<typeof createMockRepo>;
  let mail: Record<string, jest.Mock>;

  beforeEach(async () => {
    utilisateurs = createMockRepo();
    resetTokens = createMockRepo();
    verificationTokens = createMockRepo();
    mail = {
      sendPasswordResetEmail: jest.fn(),
      buildResetUrl: jest.fn(() => 'exp://haivoly/reset'),
      envoyerVerificationEmail: jest.fn(),
      buildVerificationUrl: jest.fn(() => 'exp://haivoly/verify-email?token=t'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Utilisateur), useValue: utilisateurs },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: resetTokens,
        },
        {
          provide: getRepositoryToken(EmailVerificationToken),
          useValue: verificationTokens,
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(async () => 'jwt-token') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => undefined) },
        },
        { provide: MailService, useValue: mail },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('rejette une adresse e-mail jetable (source de vérité backend)', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    await expect(
      service.register({
        nom: 'A',
        email: 'test@yopmail.com',
        password: 'MotDePasse1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'AUTH_EMAIL_DISPOSABLE' },
    });

    expect(utilisateurs.save).not.toHaveBeenCalled();
  });

  it('rejette une adresse jetable malgré la casse et les espaces', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    await expect(
      service.register({
        nom: 'A',
        email: '  Test@GuerrillaMail.COM ',
        password: 'MotDePasse1',
      }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it('accepte un fournisseur gratuit classique (non jetable)', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    await service.register({
      nom: 'A',
      email: 'rakoto@gmail.com',
      password: 'MotDePasse1',
    });

    expect(utilisateurs.save).toHaveBeenCalled();
  });

  it('émet un jeton de vérification à l’inscription', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    const resultat = await service.register({
      nom: 'A',
      email: 'rakoto@example.com',
      password: 'MotDePasse1',
    });

    expect(resultat.estVerifie).toBe(false);
    expect(verificationTokens.save).toHaveBeenCalled();
    expect(mail.envoyerVerificationEmail).toHaveBeenCalled();

    const stocke = verificationTokens.save.mock.calls[0][0] as {
      tokenHash: string;
    };
    expect(stocke.tokenHash).toHaveLength(64); // sha256 hex
  });

  it('refuse la connexion d’un compte non vérifié', async () => {
    utilisateurs.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b.mg',
      password: await bcrypt.hash('BonMotDePasse', 10),
      role: Role.AGRICULTEUR,
      estVerifie: false,
    });

    await expect(
      service.login({ email: 'a@b.mg', password: 'BonMotDePasse' }),
    ).rejects.toMatchObject({
      response: { code: 'AUTH_EMAIL_NOT_VERIFIED' },
    });
  });

  it('rejette un jeton de vérification déjà utilisé', async () => {
    verificationTokens.findOne.mockResolvedValue({
      used: true,
      expiresAt: new Date(Date.now() + 1000),
    });

    await expect(service.verifyEmail('token')).rejects.toMatchObject({
      response: { code: 'AUTH_VERIFICATION_USED' },
    });
  });

  it('rejette un jeton de vérification expiré', async () => {
    verificationTokens.findOne.mockResolvedValue({
      used: false,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.verifyEmail('token')).rejects.toMatchObject({
      response: { code: 'AUTH_VERIFICATION_EXPIRED' },
    });
  });

  it('rejette un jeton de vérification inconnu', async () => {
    verificationTokens.findOne.mockResolvedValue(null);

    await expect(service.verifyEmail('token')).rejects.toMatchObject({
      response: { code: 'AUTH_VERIFICATION_INVALID' },
    });
  });

  it('limite la fréquence des renvois de vérification', async () => {
    utilisateurs.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b.mg',
      estVerifie: false,
    });
    verificationTokens.findOne.mockResolvedValue({ createdAt: new Date() });

    await expect(service.resendVerification('a@b.mg')).rejects.toMatchObject({
      response: { code: 'AUTH_VERIFICATION_RESEND_LIMIT' },
    });
  });

  it('renvoie la même réponse pour une adresse inconnue (anti-énumération)', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    const resultat = await service.resendVerification('inconnu@haivoly.mg');

    expect(resultat.message).toContain('Si un compte non confirmé');
    expect(mail.envoyerVerificationEmail).not.toHaveBeenCalled();
  });

  it('rejette un email déjà utilisé', async () => {
    utilisateurs.findOne.mockResolvedValue({ id: 'u1' });
    await expect(
      service.register({ nom: 'A', email: 'a@b.mg', password: 'MotDePasse1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hache le mot de passe et ne renvoie jamais le hash', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    const result = await service.register({
      nom: 'Rindra',
      email: 'Rindra@Haivoly.MG',
      password: 'MotDePasse1',
    });

    const saved = utilisateurs.save.mock.calls[0][0] as {
      password: string;
      email: string;
    };
    expect(saved.password).not.toBe('MotDePasse1');
    expect(await bcrypt.compare('MotDePasse1', saved.password)).toBe(true);
    expect(saved.email).toBe('rindra@haivoly.mg'); // normalisé
    expect(
      (result as unknown as { password?: string }).password,
    ).toBeUndefined();
  });

  it('refuse un mot de passe incorrect sans révéler si l’email existe', async () => {
    utilisateurs.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b.mg',
      password: await bcrypt.hash('BonMotDePasse', 10),
      role: Role.AGRICULTEUR,
      estVerifie: true,
    });

    await expect(
      service.login({ email: 'a@b.mg', password: 'mauvais' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('délivre un token et un profil sans mot de passe', async () => {
    utilisateurs.findOne.mockResolvedValue({
      id: 'u1',
      nom: 'Rindra',
      prenom: null,
      email: 'a@b.mg',
      telephone: null,
      role: Role.AGRICULTEUR,
      estVerifie: true,
      password: await bcrypt.hash('BonMotDePasse', 10),
      creeA: new Date(),
    });

    const result = await service.login({
      email: 'a@b.mg',
      password: 'BonMotDePasse',
    });

    expect(result.access_token).toBe('jwt-token');
    expect(result.utilisateur).not.toHaveProperty('password');
  });

  it('forgot-password renvoie la même réponse pour un email inconnu (anti-énumération)', async () => {
    utilisateurs.findOne.mockResolvedValue(null);

    const result = await service.forgotPassword('inconnu@haivoly.mg');

    expect(result.message).toContain('Si un compte est associé');
    expect(resetTokens.save).not.toHaveBeenCalled();
  });

  it('forgot-password invalide les anciens tokens puis en crée un nouveau', async () => {
    utilisateurs.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.mg' });

    await service.forgotPassword('a@b.mg');

    expect(resetTokens.update).toHaveBeenCalledWith(
      { email: 'a@b.mg', used: false },
      { used: true },
    );
    expect(resetTokens.save).toHaveBeenCalled();
  });

  it('rejette un token de réinitialisation inconnu', async () => {
    resetTokens.findOne.mockResolvedValue(null);

    await expect(
      service.resetPassword('token-inconnu', 'NouveauPass1', 'NouveauPass1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un token déjà utilisé', async () => {
    resetTokens.findOne.mockResolvedValue({
      used: true,
      expiresAt: new Date(Date.now() + 1000),
    });

    await expect(
      service.resetPassword('token', 'NouveauPass1', 'NouveauPass1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un token expiré', async () => {
    resetTokens.findOne.mockResolvedValue({
      used: false,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.resetPassword('token', 'NouveauPass1', 'NouveauPass1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette des mots de passe non identiques', async () => {
    await expect(
      service.resetPassword('token', 'NouveauPass1', 'AutrePass1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stocke uniquement le hash SHA-256 du token', async () => {
    utilisateurs.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.mg' });

    const result = await service.forgotPassword('a@b.mg');
    const rawToken = (result as { _devToken?: string })._devToken;
    const storedToken = resetTokens.save.mock.calls[0][0] as {
      tokenHash: string;
    };

    expect(rawToken).toBeDefined();
    expect(storedToken.tokenHash).not.toBe(rawToken);
    expect(storedToken.tokenHash).toHaveLength(64); // sha256 hex
  });
});
