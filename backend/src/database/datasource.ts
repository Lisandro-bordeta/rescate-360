import { AppDataSource } from '../../ormconfig';

/**
 * Inicializa la conexión con PostgreSQL/PostGIS.
 * En producción se ejecutan las migraciones por separado (npm run migration:run).
 */
export const initializeDatabase = async (): Promise<void> => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  console.log('[Database] Conexión establecida con PostgreSQL/PostGIS');
};

export const closeDatabase = async (): Promise<void> => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
};

export { AppDataSource };
