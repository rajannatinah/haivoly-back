import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { Utilisateur } from '../../users/entities/utilisateur.entity';

@Entity({ name: 'PasswordSetupToken' })
export class PasswordSetupToken extends BaseEntity {
  @Index('PasswordSetupToken_utilisateur_idx')
  @Column({ type: 'text', name: 'utilisateurId' })
  utilisateurId: string;

  @Index('PasswordSetupToken_tokenHash_key', { unique: true })
  @Column({ type: 'text', name: 'tokenHash' })
  tokenHash: string;

  @Index('PasswordSetupToken_expiresAt_idx')
  @Column({ type: 'timestamp', precision: 3, name: 'expiresAt' })
  expiresAt: Date;

  @Column({ type: 'boolean', default: false })
  used: boolean;

  @ManyToOne(() => Utilisateur, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'utilisateurId' })
  utilisateur: Utilisateur | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3, name: 'createdAt' })
  createdAt: Date;
}
