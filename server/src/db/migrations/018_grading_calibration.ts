import type { Database } from 'sql.js';

export const gradingCalibrationMigration = {
  id: '018_grading_calibration',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS grading_calibrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE UNIQUE,
      sample_size INTEGER NOT NULL DEFAULT 0,
      mae REAL,
      bias REAL,
      acceptance_rate REAL,
      modification_rate REAL,
      status TEXT NOT NULL DEFAULT 'insufficient_sample',
      computed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  },
};
