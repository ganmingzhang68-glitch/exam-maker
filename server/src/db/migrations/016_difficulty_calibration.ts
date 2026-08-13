import type { Database } from 'sql.js';

function columns(database: Database, table: string): Set<string> {
  return new Set((database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map(row => String(row[1])));
}

export const difficultyCalibrationMigration = {
  id: '016_difficulty_calibration',
  up(database: Database): void {
    const questionColumns = columns(database, 'questions');
    if (!questionColumns.has('predicted_difficulty_score')) {
      database.run('ALTER TABLE questions ADD COLUMN predicted_difficulty_score REAL CHECK(predicted_difficulty_score BETWEEN 0 AND 1)');
    }
    if (!questionColumns.has('teacher_difficulty_score')) {
      database.run('ALTER TABLE questions ADD COLUMN teacher_difficulty_score REAL CHECK(teacher_difficulty_score BETWEEN 0 AND 1)');
    }
    database.run(`CREATE TABLE IF NOT EXISTS difficulty_calibration_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
      question_quality_report_id INTEGER NOT NULL REFERENCES question_quality_reports(id) ON DELETE CASCADE,
      predicted_difficulty REAL,
      teacher_difficulty REAL,
      empirical_difficulty REAL NOT NULL,
      sample_size INTEGER NOT NULL,
      prediction_error REAL,
      calibration_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(question_quality_report_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS difficulty_calibration_records_course_idx ON difficulty_calibration_records(course_id, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS difficulty_calibration_records_question_idx ON difficulty_calibration_records(question_id, created_at)');
    database.run(`CREATE TABLE IF NOT EXISTS course_difficulty_calibrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE UNIQUE,
      sample_size INTEGER NOT NULL DEFAULT 0,
      mae REAL,
      rmse REAL,
      bias REAL,
      status TEXT NOT NULL DEFAULT 'insufficient_sample',
      computed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  },
};
