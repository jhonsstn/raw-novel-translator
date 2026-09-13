import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export interface DatabaseHandle {
  sqlite: Database.Database;
  db: AppDatabase;
}

let singleton: DatabaseHandle | undefined;

function compareVersions(actual: string, minimum: string): number {
  const a = actual.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function openDatabase(path = process.env.DATABASE_PATH): DatabaseHandle {
  if (!path || !path.startsWith('/')) throw new Error('DATABASE_PATH must be an absolute path');
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('busy_timeout = 5000');
  const versionRow: unknown = sqlite.prepare('select sqlite_version() as version').get();
  if (
    !versionRow ||
    typeof versionRow !== 'object' ||
    !('version' in versionRow) ||
    typeof versionRow.version !== 'string'
  ) {
    sqlite.close();
    throw new Error('Could not read SQLite version');
  }
  const version = versionRow.version;
  if (compareVersions(version, '3.51.3') < 0) {
    sqlite.close();
    throw new Error(`SQLite ${version} is unsupported; version 3.51.3 or newer is required`);
  }
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function getDatabase(): DatabaseHandle {
  singleton ??= openDatabase();
  return singleton;
}

export function closeDatabase(): void {
  singleton?.sqlite.close();
  singleton = undefined;
}
