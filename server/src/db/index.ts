import { drizzle, SQLJsDatabase } from 'drizzle-orm/sql-js';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as schema from './schema.js';
export { schema };
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');
const dbPath = join(dataDir, 'exam-maker.db');

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

let SQL: SqlJsDatabase | null = null;
export let db: SQLJsDatabase<typeof schema>;
export let rawDb: SqlJsDatabase;

function saveToDisk() {
  if (SQL) {
    const buffer = SQL.export();
    writeFileSync(dbPath, Buffer.from(buffer));
  }
}

// Auto-save every 30 seconds
setInterval(saveToDisk, 30000);

// Save on process exit
process.on('exit', saveToDisk);
process.on('SIGINT', () => { saveToDisk(); process.exit(); });
process.on('SIGTERM', () => { saveToDisk(); process.exit(); });

export async function initDb(): Promise<void> {
  const initSqlJsLib = initSqlJs as unknown as () => Promise<typeof initSqlJs>;
  const sqlJs = await initSqlJsLib();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    SQL = new sqlJs.Database(buffer);
  } else {
    SQL = new sqlJs.Database();
  }

  SQL.run('PRAGMA foreign_keys = ON');

  rawDb = SQL;
  db = drizzle(SQL, { schema });
}

export { saveToDisk };
