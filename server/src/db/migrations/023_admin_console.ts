import type { Database } from 'sql.js';
export const adminConsoleMigration = { id: '023_admin_console', up(database: Database): void {
  const columns = database.exec("PRAGMA table_info('users')")[0]?.values.map(row => String(row[1])) ?? [];
  if (!columns.includes('is_active')) database.run('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  if (!columns.includes('token_version')) database.run('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('disabled_at')) database.run('ALTER TABLE users ADD COLUMN disabled_at TEXT');
  if (!columns.includes('updated_at')) database.run("ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
  database.run(`CREATE TABLE IF NOT EXISTS system_audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, before_json TEXT, after_json TEXT, request_id TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  database.run('CREATE INDEX IF NOT EXISTS system_audit_logs_created_idx ON system_audit_logs(created_at)'); database.run('CREATE INDEX IF NOT EXISTS system_audit_logs_resource_idx ON system_audit_logs(resource_type, resource_id)');
  database.run(`CREATE TABLE IF NOT EXISTS ai_cost_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, model TEXT NOT NULL, input_cost_per_million REAL NOT NULL, output_cost_per_million REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', effective_from TEXT NOT NULL, effective_to TEXT, created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(provider, model, effective_from))`);
} };
