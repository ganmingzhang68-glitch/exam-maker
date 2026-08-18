import type { Database } from 'sql.js';

export const aiGradingSuggestionsMigration = {
  id: '017_ai_grading_suggestions',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS ai_grading_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      answer_id INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
      suggested_score REAL,
      max_score REAL NOT NULL,
      rubric_item_scores TEXT NOT NULL DEFAULT '[]',
      reasoning_summary TEXT,
      missing_points TEXT NOT NULL DEFAULT '[]',
      matched_points TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','accepted','modified','superseded')),
      provider TEXT,
      model TEXT,
      prompt_version_id INTEGER REFERENCES prompt_versions(id) ON DELETE SET NULL,
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      error_message TEXT,
      teacher_final_score REAL,
      score_difference REAL,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS ai_grading_suggestions_answer_status_idx ON ai_grading_suggestions(answer_id, status, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS ai_grading_suggestions_ai_run_idx ON ai_grading_suggestions(ai_run_id)');
  },
};
