import type { Database } from 'sql.js';
export const organizationsMigration = { id: '024_organizations', up(database: Database): void {
  database.run(`CREATE TABLE IF NOT EXISTS organizations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS user_organizations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member', is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, organization_id))`);
  database.run("INSERT OR IGNORE INTO organizations(id,name,code,status) VALUES (1,'默认学校','default','active')");
  database.run("INSERT OR IGNORE INTO user_organizations(user_id,organization_id,role,is_default) SELECT id,1,CASE WHEN role='admin' THEN 'admin' ELSE 'member' END,1 FROM users");
  for (const table of ['courses','teaching_classes','questions','papers','exams']) {
    const columns = database.exec(`PRAGMA table_info('${table}')`)[0]?.values.map(row => String(row[1])) ?? [];
    if (!columns.includes('organization_id')) database.run(`ALTER TABLE ${table} ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1`);
    database.run(`UPDATE ${table} SET organization_id=1 WHERE organization_id IS NULL`);
    database.run(`CREATE INDEX IF NOT EXISTS ${table}_organization_idx ON ${table}(organization_id)`);
  }
  database.run('CREATE INDEX IF NOT EXISTS user_organizations_org_idx ON user_organizations(organization_id,role)');
} };
