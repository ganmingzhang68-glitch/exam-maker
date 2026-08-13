import type { Database } from 'sql.js';
export const teachingAnalyticsMigration = {
  id: '021_teaching_analytics',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS teaching_analytics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      generated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'ready',
      calculation_version TEXT NOT NULL,
      input_cutoff_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      attention_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS teaching_analytics_course_created_idx ON teaching_analytics_snapshots(course_id, created_at)');
  },
};
