import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Usuario } from './Usuario';

@Entity('tracking_ubicacion')
@Index(['usuario_id', 'fecha_registro'], { order: { fecha_registro: 'DESC' } })
@Index(['sincronizado'])
export class TrackingUbicacion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: false })
  usuario_id!: string;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario!: Usuario;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: false })
  latitud!: number;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: false })
  longitud!: number;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  precision?: number | null; // metros

  @Column({ type: 'integer', nullable: true })
  bateria?: number | null; // 0-100

  @Column({ type: 'varchar', length: 100, nullable: true })
  dispositivo_id?: string | null;

  /**
   * Secuencia local del cliente para deduplicación de trazas enviadas en offline.
   */
  @Column({ type: 'integer', nullable: false })
  secuencia_local!: number;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_registro!: Date;

  @Column({ type: 'boolean', default: false })
  sincronizado!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  enviado_en?: Date | null;
}
