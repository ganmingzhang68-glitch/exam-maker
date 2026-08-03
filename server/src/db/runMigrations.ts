import { initDb, saveToDisk } from './index.js';
import { runMigrations } from './migrate.js';

await initDb();
runMigrations();
saveToDisk();
