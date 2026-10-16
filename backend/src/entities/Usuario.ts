import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Refugio } from './Refugio';
import { TrackingUbicacion } from './TrackingUbicacion';

export type NivelVulnerabilidad = 'estandar' | 'niño' | 'adulto_mayor' | 'discapacidad';
export type RolUsuario = 'ciudadano' | 'rescatista' | 'admin';

@Entity('usuarios')
@Index(['sub_mi_arg'], { unique: true })
@Index(['dni'], { unique: true })
@Index(['email'], { unique: true })
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, nullable: false })
  dni!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  nombre!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  apellido!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  telefono?: string | null;

  /**
   * Subject (sub) del token OIDC emitido por Mi Argentina (AUTENTICAR).
   */
  @Column({ type: 'varchar', length: 255, nullable: false })
  sub_mi_arg!: string;

  @Column({
    type: 'enum',
    enum: ['estandar', 'niño', 'adulto_mayor', 'discapacidad'],
    default: 'estandar',
  })
  nivel_vulnerabilidad!: NivelVulnerabilidad;

  @Column({ type: 'text', nullable: true })
  fcm_token?: string | null;

  @Column({ type: 'enum', enum: ['ciudadano', 'rescatista', 'admin'], default: 'ciudadano' })
  rol!: RolUsuario;

  @ManyToOne(() => Refugio, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'refugio_asignado_id' })
  refugio_asignado?: Refugio | null;

  @Column({ type: 'uuid', nullable: true })
  refugio_asignado_id?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_registro!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_actualizacion!: Date;

  @OneToMany(() => TrackingUbicacion, (tracking) => tracking.usuario)
  tracking!: TrackingUbicacion[];

  get nombreCompleto(): string {
    return `${this.nombre} ${this.apellido}`;
  }
}
