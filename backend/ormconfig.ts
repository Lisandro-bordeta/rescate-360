import { DataSource } from 'typeorm';
import * as path from 'path';
import { env } from './src/config/env';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  entities: [path.join(__dirname, 'src/entities/*.{ts,js}')],
  migrations: [path.join(__dirname, 'src/migrations/*.{ts,js}')],
  subscribers: [],
  synchronize: false, // Producción: usar migraciones. En desarrollo se puede activar temporalmente.
  logging: env.NODE_ENV === 'development',
});

export default AppDataSource;
