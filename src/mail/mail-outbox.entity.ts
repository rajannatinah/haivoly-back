import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';

export const StatutEnvoiEmail = {
  EN_ATTENTE: 'EN_ATTENTE',
  EN_COURS: 'EN_COURS',
  ENVOYE: 'ENVOYE',
  ECHEC: 'ECHEC',
} as const;

export type StatutEnvoiEmail =
  (typeof StatutEnvoiEmail)[keyof typeof StatutEnvoiEmail];

@Entity({ name: 'EmailOutbox' })
@Index('EmailOutbox_statut_prochain_idx', ['statut', 'prochainEnvoiA'])
export class EmailOutbox {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id: string;

  /** Clé de dédoublonnage fournie par l'émetteur (ex. `verification:<idUtilisateur>:<jeton>`). */
  @Index('UQ_EmailOutbox_cleIdempotence', { unique: true })
  @Column({ type: 'text', name: 'cleIdempotence' })
  cleIdempotence: string;

  @Column({ type: 'text', name: 'typeEvenement' })
  typeEvenement: string;

  @Column({ type: 'text' })
  destinataire: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  langue: string | null;

  @Column({ type: 'text' })
  sujet: string;

  @Column({ type: 'text' })
  texte: string;

  @Column({ type: 'text' })
  html: string;

  @Column({
    type: 'text',
    default: StatutEnvoiEmail.EN_ATTENTE,
  })
  statut: StatutEnvoiEmail;

  @Column({ type: 'int', name: 'tentatives', default: 0 })
  tentatives: number;

  @Column({ type: 'timestamp', precision: 3, name: 'prochainEnvoiA' })
  prochainEnvoiA: Date;

  @Column({ type: 'timestamp', precision: 3, name: 'envoyeA', nullable: true })
  envoyeA: Date | null;

  /** Code technique du dernier échec (jamais la réponse SMTP brute). */
  @Column({ type: 'text', name: 'dernierCodeErreur', nullable: true })
  dernierCodeErreur: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3, name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3, name: 'updatedAt' })
  updatedAt: Date;
}

export function nouveauIdEmailOutbox(): string {
  return randomUUID();
}
