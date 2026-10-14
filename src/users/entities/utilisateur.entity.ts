import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  UpdateDateColumn,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { Role } from '../../common/enums/domain.enums';
import type { Parcelle } from '../../parcelles/entities/parcelle.entity';
import type { PasswordResetToken } from '../../auth/entities/password-reset-token.entity';
import type { EmailVerificationToken } from '../../auth/entities/email-verification-token.entity';
import type { Action } from '../../actions/entities/action.entity';
import type { Recommendation } from '../../recommendations/entities/recommendation.entity';

@Entity({ name: 'Utilisateur' })
@Index('UQ_Utilisateur_username', ['username'], { unique: true })
export class Utilisateur extends BaseEntity {
  @Column({ type: 'text' })
  nom: string;

  @Column({ type: 'text', nullable: true })
  prenom: string | null;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'varchar', length: 30 })
  username: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  langue: string | null;

  @Column({ type: 'text', nullable: true })
  telephone: string | null;

  /** Hash bcrypt — ne jamais exposer dans une réponse API. */
  @Column({ type: 'text' })
  password: string;

  @Column({
    type: 'enum',
    enum: Role,
    enumName: 'Role',
    default: Role.PROPRIETAIRE,
  })
  role: Role;

  /** Adresse e-mail confirmée par l'utilisateur (preuve de possession). */
  @Column({ type: 'boolean', name: 'estVerifie', default: false })
  estVerifie: boolean;

  @Column({ type: 'boolean', name: 'motDePasseProvisoire', default: false })
  motDePasseProvisoire: boolean;

  @Column({
    type: 'timestamp',
    precision: 3,
    name: 'emailVerifieA',
    nullable: true,
  })
  emailVerifieA: Date | null;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 3,
    name: 'creeA',
  })
  creeA: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    precision: 3,
    name: 'modifieA',
  })
  modifieA: Date;

  /** Rattachement a un PROPRIETAIRE : null pour un compte non rattache. */
  @Column({ type: 'text', name: 'proprietaireId', nullable: true })
  proprietaireId: string | null;

  @ManyToOne('Utilisateur', 'agriculteurs', {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'proprietaireId' })
  proprietaire: Utilisateur | null;

  @OneToMany('Utilisateur', 'proprietaire')
  agriculteurs: Utilisateur[];

  @OneToMany('Parcelle', 'utilisateur')
  parcelles: Parcelle[];

  @OneToMany('PasswordResetToken', 'utilisateur')
  passwordResetTokens: PasswordResetToken[];

  @OneToMany('EmailVerificationToken', 'utilisateur')
  emailVerificationTokens: EmailVerificationToken[];

  @OneToMany('Action', 'utilisateur')
  actions: Action[];

  @OneToMany('Recommendation', 'utilisateur')
  recommendations: Recommendation[];
}
