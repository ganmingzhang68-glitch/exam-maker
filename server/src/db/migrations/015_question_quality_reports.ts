import type { Database } from 'sql.js';

export const questionQualityReportsMigration = {
  id: '015_question_quality_reports',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS question_quality_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      paper_question_id INTEGER NOT NULL REFERENCES paper_questions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
      sample_size INTEGER NOT NULL,
      correct_rate REAL,
      empirical_difficulty REAL,
      discrimination_index REAL,
      point_biserial REAL,
      option_statistics TEXT NOT NULL DEFAULT '[]',
      blank_rate REAL NOT NULL DEFAULT 0,
      average_score_rate REAL,
      quality_flags TEXT NOT NULL DEFAULT '[]',
      metric_status TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(exam_id, paper_question_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS question_quality_reports_exam_status_idx ON question_quality_reports(exam_id, review_status)');
    database.run('CREATE INDEX IF NOT EXISTS question_quality_reports_question_idx ON question_quality_reports(question_id, created_at)');
  },
};
