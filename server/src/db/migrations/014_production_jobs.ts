import type { Database } from 'sql.js';

function columns(database: Database, table: string): Set<string> {
  return new Set((database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map(row => String(row[1])));
}

function addColumn(database: Database, table: string, definition: string): void {
  const name = definition.split(/\s+/, 1)[0];
  if (!columns(database, table).has(name)) database.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export const productionJobsMigration = {
  id: '014_production_jobs',
  up(database: Database): void {
    for (const table of ['generation_jobs', 'similar_question_jobs']) {
      addColumn(database, table, 'task_status TEXT');
      addColumn(database, table, 'request_id TEXT');
      addColumn(database, table, 'idempotency_key TEXT');
      addColumn(database, table, 'cancel_requested_at TEXT');
      addColumn(database, table, 'finished_at TEXT');
    }
    database.run(`UPDATE generation_jobs SET task_status = CASE status
      WHEN 'pending' THEN 'queued' WHEN 'running' THEN 'running'
      WHEN 'succeeded' THEN 'succeeded' WHEN 'failed' THEN 'failed'
      WHEN 'cancelled' THEN 'cancelled' ELSE 'blocked' END
      WHERE task_status IS NULL`);
    database.run(`UPDATE similar_question_jobs SET task_status = CASE status
      WHEN 'pending' THEN 'queued' WHEN 'running' THEN 'running'
      WHEN 'succeeded' THEN 'succeeded' WHEN 'saved' THEN 'succeeded'
      WHEN 'failed' THEN 'failed' ELSE 'blocked' END
      WHERE task_status IS NULL`);
    database.run('CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_owner_idempotency_idx ON generation_jobs(requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL');
    database.run('CREATE UNIQUE INDEX IF NOT EXISTS similar_question_jobs_owner_idempotency_idx ON similar_question_jobs(requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL');
    database.run('CREATE INDEX IF NOT EXISTS generation_jobs_owner_task_status_idx ON generation_jobs(requested_by, task_status, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS similar_question_jobs_owner_task_status_idx ON similar_question_jobs(requested_by, task_status, created_at)');
  },
};
