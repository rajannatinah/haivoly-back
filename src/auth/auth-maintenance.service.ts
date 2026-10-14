import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { MailOutboxService } from '../mail/mail-outbox.service';

@Injectable()
export class AuthMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthMaintenanceService.name);
  private temporisateur: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly file: MailOutboxService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalle = Number(
      this.config.get<string>('MAINTENANCE_INTERVALLE_MS') ?? 3_600_000,
    );

    if (
      (this.config.get<string>('NODE_ENV') ?? 'development') === 'test' ||
      !Number.isFinite(intervalle) ||
      intervalle <= 0
    ) {
      return;
    }

    this.temporisateur = setInterval(() => {
      void this.executer();
    }, intervalle);
    this.temporisateur.unref?.();
  }

  onModuleDestroy(): void {
    if (this.temporisateur) clearInterval(this.temporisateur);
    this.temporisateur = null;
  }

  /** Exécutée aussi au démarrage : une reprise après arrêt long est attendue. */
  private async executer(): Promise<{
    jetonsReinitialisation: number;
    jetonsVerification: number;
    jetonsActivation: number;
    messagesLivresPurges: number;
  }> {
    const reinitialisation = await this.auth
      .purgeExpiredResetTokens()
      .catch(() => 0);
    const verification = await this.auth
      .purgeExpiredVerificationTokens()
      .catch(() => 0);
    const activation = await this.auth.purgeExpiredSetupTokens().catch(() => 0);
    const messages = await this.file
      .purgerMessagesLivres(
        Number(this.config.get<string>('MAIL_PURGE_MESSAGE_HEURES') ?? 24),
      )
      .catch(() => 0);

    const total = reinitialisation + verification + activation + messages;
    if (total > 0) {
      this.logger.log(
        `Maintenance : ${total} élément(s) périmé(s) supprimés (jetons et messages livrés).`,
      );
    }

    return {
      jetonsReinitialisation: reinitialisation,
      jetonsVerification: verification,
      jetonsActivation: activation,
      messagesLivresPurges: messages,
    };
  }
}
