import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { SyncStatus } from '../../common/enums/domain.enums';
import { Utilisateur } from '../../users/entities/utilisateur.entity';

@Entity({ name: 'Action' })
@Index('Action_userId_clientId_key', ['userId', 'clientId'], { unique: true })
export class Action extends BaseEntity {
  @Column({ type: 'text', name: 'clientId', nullable: true })
  clientId: string | null;

  @Index('Action_userId_idx')
  @Column({ type: 'text', name: 'userId' })
  userId: string;

  @ManyToOne(() => Utilisateur, (u) => u.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  utilisateur: Utilisateur;

  @Index('Action_actionType_idx')
  @Column({ type: 'text', name: 'actionType' })
  actionType: string;

  @Index('Action_entityType_idx')
  @Column({ type: 'text', name: 'entityType' })
  entityType: string;

  @Column({ type: 'text', name: 'entityId', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Index('Action_timestamp_idx')
  @Column({
    type: 'timestamp',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP',
  })
  timestamp: Date;

  @Column({ type: 'text', name: 'deviceId', nullable: true })
  deviceId: string | null;

  @Index('Action_syncStatus_idx')
  @Column({ type: 'text', name: 'syncStatus', default: SyncStatus.SYNCED })
  syncStatus: string;

  @Column({ type: 'integer', name: 'retryCount', default: 0 })
  retryCount: number;

  @Column({ type: 'timestamp', precision: 3, name: 'syncedAt', nullable: true })
  syncedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index('Action_createdAt_idx')
  @CreateDateColumn({ type: 'timestamp', precision: 3, name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3, name: 'updatedAt' })
  updatedAt: Date;
}
