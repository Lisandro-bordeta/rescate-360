import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type TipoRefugio = 'urbano' | 'rural';

@Entity('refugios')
@Index(['tipo'])
@Index(['activo'])
export class Refugio {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  nombre!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  direccion?: string | null;

  @Column({ type: 'enum', enum: ['urbano', 'rural'], default: 'urbano' })
  tipo!: TipoRefugio;

  @Column({ type: 'integer', default: 0 })
  capacidad!: number;

  @Column({ type: 'integer', default: 0 })
  ocupacion_actual!: number;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: false })
  ubicacion_lat!: number;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: false })
  ubicacion_lon!: number;

  /**
   * WKT del polígono que define la zona segura del refugio.
   * Se mantiene como texto para simplicidad; las consultas espaciales usan PostGIS.
   */
  @Column({ type: 'text', nullable: true })
  zona_segura_wkt?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_actualizacion!: Date;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  fecha_registro!: Date;
}
