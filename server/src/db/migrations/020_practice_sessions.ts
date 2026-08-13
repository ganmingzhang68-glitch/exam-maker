import type { Database } from 'sql.js';

export const practiceSessionsMigration = {
  id: '020_practice_sessions',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      knowledge_point_id INTEGER REFERENCES knowledge_points(id) ON DELETE SET NULL,
      requested_count INTEGER NOT NULL,
      selected_count INTEGER NOT NULL DEFAULT 0,
      shortage_count INTEGER NOT NULL DEFAULT 0,
      difficulty TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      score_earned REAL NOT NULL DEFAULT 0,
      score_possible REAL NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run(`CREATE TABLE IF NOT EXISTS practice_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE REFERENCES practice_sessions(id) ON DELETE CASCADE,
      requested_distribution TEXT NOT NULL DEFAULT '{}',
      selected_distribution TEXT NOT NULL DEFAULT '{}',
      question_ids TEXT NOT NULL DEFAULT '[]',
      shortages TEXT NOT NULL DEFAULT '[]',
      selection_version TEXT NOT NULL DEFAULT 'bank-objective-v1',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run(`CREATE TABLE IF NOT EXISTS practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
      order_no INTEGER NOT NULL,
      question_snapshot TEXT NOT NULL,
      answer_content TEXT,
      score REAL,
      max_score REAL NOT NULL,
      is_correct INTEGER,
      knowledge_point_ids TEXT NOT NULL DEFAULT '[]',
      time_spent_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      answered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, order_no), UNIQUE(session_id, question_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS practice_sessions_student_status_idx ON practice_sessions(student_id, status, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS practice_sessions_course_idx ON practice_sessions(course_id, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS practice_attempts_question_idx ON practice_attempts(question_id, status)');
  },
};
