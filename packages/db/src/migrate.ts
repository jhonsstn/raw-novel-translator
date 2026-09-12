import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getDatabase } from './client.js';

export function migrate(): void {
  const { sqlite } = getDatabase();
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = sqlite.prepare('SELECT 1 FROM _migrations WHERE name = ?');
  const record = sqlite.prepare('INSERT INTO _migrations(name, applied_at) VALUES (?, ?)');
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    if (applied.get(name)) continue;
    const sql = readFileSync(resolve(directory, name), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      record.run(name, Date.now());
    })();
    console.log(`Applied ${name}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) migrate();
