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
import { StatutParcelle } from '../../common/enums/domain.enums';
import { Utilisateur } from '../../users/entities/utilisateur.entity';
import type { Culture } from '../../cultures/entities/culture.entity';
import type { PointGPS } from '../../points-gps/entities/point-gps.entity';

@Entity({ name: 'Parcelle' })
export class Parcelle extends BaseEntity {
  @Column({ type: 'text' })
  nom: string;

  @Column({ type: 'double precision', nullable: true })
  superficie: number | null;

  @Column({ type: 'text', name: 'typeSol', nullable: true })
  typeSol: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: StatutParcelle,
    enumName: 'StatutParcelle',
    default: StatutParcelle.ACTIVE,
  })
  statut: StatutParcelle;

  @Column({ type: 'text', name: 'raisonSuppression', nullable: true })
  raisonSuppression: string | null;

  @Index('IDX_Parcelle_utilisateurId')
  @Column({ type: 'text', name: 'utilisateurId' })
  utilisateurId: string;

  @ManyToOne(() => Utilisateur, (u) => u.parcelles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'utilisateurId' })
  utilisateur: Utilisateur;

  @OneToMany('Culture', 'parcelle')
  cultures: Culture[];

  /**
   * Calculé par la liste (GET /parcelles) : nombre de cultures hors
   * supprimées. Champ non persisté (aucun décorateur TypeORM).
   */
  nombreCultures?: number;

  @OneToMany('PointGPS', 'parcelle')
  pointsGPS: PointGPS[];

  @CreateDateColumn({ type: 'timestamp', precision: 3, name: 'creeA' })
  creeA: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3, name: 'modifieA' })
  modifieA: Date;
}
