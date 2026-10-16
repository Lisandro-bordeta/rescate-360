import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type TipoAlertaInundacion = 'verde' | 'amarilla' | 'naranja' | 'roja';

@Entity('alertas_inundacion')
@Index(['activo', 'fecha_inicio'])
export class AlertaInundacion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  zona!: string;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: false })
  nivel_agua!: number; // cm sobre nivel base

  @Column({
    type: 'enum',
    enum: ['verde', 'amarilla', 'naranja', 'roja'],
    default: 'verde',
  })
  tipo_alerta!: TipoAlertaInundacion;

  /**
   * WKT del polígono/multipolígono del área anegada (EPSG:4326).
   */
  @Column({ type: 'text', nullable: false })
  geom_wkt!: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_inicio!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  fecha_fin?: Date | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_actualizacion!: Date;
}
