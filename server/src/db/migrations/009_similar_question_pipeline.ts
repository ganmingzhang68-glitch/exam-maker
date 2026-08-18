import type { Database } from 'sql.js';

function columns(database: Database, table: string): Set<string> {
  return new Set((database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map(row => String(row[1])));
}

export const similarQuestionPipelineMigration = {
  id: '009_similar_question_pipeline',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS similar_question_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course TEXT NOT NULL,
      scope TEXT,
      source_text TEXT NOT NULL,
      source_answer TEXT,
      variants_per_question INTEGER NOT NULL DEFAULT 1 CHECK(variants_per_question BETWEEN 1 AND 5),
      default_score REAL NOT NULL DEFAULT 10 CHECK(default_score > 0),
      difficulty_mode TEXT NOT NULL DEFAULT 'same' CHECK(difficulty_mode IN ('same','lower','higher')),
      current_stage TEXT,
      last_successful_stage TEXT,
      error_summary TEXT,
      result_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','saved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS similar_question_jobs_owner_status_idx ON similar_question_jobs(requested_by, status)');
    database.run(`CREATE TABLE IF NOT EXISTS similar_question_job_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES similar_question_jobs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT,
      error_message TEXT,
      error_stack TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(job_id, stage, attempt_no)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS similar_question_job_stages_job_status_idx ON similar_question_job_stages(job_id, status)');

    if (!columns(database, 'ai_runs').has('similar_question_job_id')) {
      database.run('ALTER TABLE ai_runs ADD COLUMN similar_question_job_id INTEGER REFERENCES similar_question_jobs(id) ON DELETE SET NULL');
      database.run('CREATE INDEX IF NOT EXISTS ai_runs_similar_question_job_idx ON ai_runs(similar_question_job_id, stage)');
    }
    if (!columns(database, 'generated_questions').has('similar_question_job_id')) {
      database.run('ALTER TABLE generated_questions ADD COLUMN similar_question_job_id INTEGER REFERENCES similar_question_jobs(id) ON DELETE SET NULL');
      database.run('CREATE INDEX IF NOT EXISTS generated_questions_similar_job_idx ON generated_questions(similar_question_job_id)');
    }
  },
};
