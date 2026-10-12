import fs from 'fs';
import path from 'path';
import { getPool } from './connection';

export function getSchemaSql(): string {
  const candidatePaths = [
    path.join(__dirname, '../../db/schema.sql'),
    path.join(__dirname, '../db/schema.sql'),
    path.resolve(process.cwd(), 'db/schema.sql'),
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`schema.sql not found in candidate paths: ${candidatePaths.join(', ')}`);
}

export function getSeedSql(): string {
  const candidatePaths = [
    path.join(__dirname, '../../db/seed.sql'),
    path.join(__dirname, '../db/seed.sql'),
    path.resolve(process.cwd(), 'db/seed.sql'),
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return '';
}

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  try {
    const schemaSql = getSchemaSql();
    await pool.query(schemaSql);

    // Create supplementary tables if not present
    const extraSql = `
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT 'system',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS code_packages (
        id TEXT PRIMARY KEY,
        package_name TEXT NOT NULL,
        file_size_mb NUMERIC(6,2) NOT NULL DEFAULT 0.18,
        sha256 TEXT NOT NULL,
        source_path TEXT NOT NULL,
        components JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      INSERT INTO system_settings (key, value, updated_by)
      VALUES ('kill_switch', 'ENABLED', 'system')
      ON CONFLICT (key) DO NOTHING;
    `;
    await pool.query(extraSql);

    const seedSql = getSeedSql();
    if (seedSql) {
      await pool.query(seedSql);
    }

    console.log('[Database]: Schema migrations and seed applied successfully.');
  } catch (error: any) {
    console.warn('[Database Migration Warning]:', error.message);
  }
}

export const initDatabase = runMigrations;
