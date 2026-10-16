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

export type EstadoSms = 'pendiente' | 'enviado' | 'fallido';

@Entity('cola_sms_sos')
@Index(['estado', 'creado_en'], { where: "estado = 'pendiente'" })
export class ColaSmsSos {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: false })
  usuario_id!: string;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario!: Usuario;

  @Column({ type: 'text', nullable: false })
  mensaje!: string;

  @Column({ type: 'varchar', length: 30, nullable: false })
  telefono_destino!: string;

  @Column({
    type: 'enum',
    enum: ['pendiente', 'enviado', 'fallido'],
    default: 'pendiente',
  })
  estado!: EstadoSms;

  @Column({ type: 'integer', default: 0 })
  intentos!: number;

  @Column({ type: 'integer', default: 5 })
  max_intentos!: number;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  creado_en!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  enviado_en?: Date | null;

  @Column({ type: 'text', nullable: true })
  ultimo_error?: string | null;
}
