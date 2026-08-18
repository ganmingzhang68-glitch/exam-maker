import type { Database } from 'sql.js';

function hasColumn(database: Database, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  return (result[0]?.values ?? []).some((row) => String(row[1]) === column);
}

function addColumn(database: Database, table: string, definition: string): void {
  const column = definition.trim().split(/\s+/, 1)[0];
  if (!hasColumn(database, table, column)) database.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export const promptAiRunMetadataMigration = {
  id: '006_prompt_ai_run_metadata',
  up(database: Database): void {
    addColumn(database, 'prompt_versions', 'prompt_id TEXT');
    addColumn(database, 'prompt_versions', 'pipeline_stage TEXT');
    addColumn(database, 'prompt_versions', 'template_hash TEXT');
    addColumn(database, 'prompt_versions', 'schema_hash TEXT');
    database.run(`UPDATE prompt_versions SET
      prompt_id = COALESCE(prompt_id, key),
      pipeline_stage = COALESCE(pipeline_stage, stage),
      template_hash = COALESCE(template_hash, sha256),
      schema_hash = COALESCE(schema_hash, sha256)`);

    addColumn(database, 'generation_job_stages', "input_artifact_ids TEXT NOT NULL DEFAULT '[]'");
    addColumn(database, 'generation_job_stages', "output_artifact_ids TEXT NOT NULL DEFAULT '[]'");

    addColumn(database, 'ai_runs', 'stage_run_id INTEGER REFERENCES generation_job_stages(id) ON DELETE SET NULL');
    addColumn(database, 'ai_runs', "model_parameters TEXT NOT NULL DEFAULT '{}'");
    addColumn(database, 'ai_runs', 'input_hash TEXT');
    addColumn(database, 'ai_runs', 'output_raw TEXT');
    addColumn(database, 'ai_runs', 'output_parsed TEXT');
    addColumn(database, 'ai_runs', 'error_type TEXT');
    addColumn(database, 'ai_runs', 'retry_count INTEGER NOT NULL DEFAULT 0');
    addColumn(database, 'ai_runs', 'total_tokens INTEGER');
    addColumn(database, 'ai_runs', 'latency_ms INTEGER');
    addColumn(database, 'ai_runs', 'started_at TEXT');
    addColumn(database, 'ai_runs', 'finished_at TEXT');
    database.run('UPDATE ai_runs SET model_parameters = parameters WHERE model_parameters = \'{}\' AND parameters IS NOT NULL');
    database.run('CREATE INDEX IF NOT EXISTS ai_runs_stage_run_idx ON ai_runs(stage_run_id)');
  },
};
