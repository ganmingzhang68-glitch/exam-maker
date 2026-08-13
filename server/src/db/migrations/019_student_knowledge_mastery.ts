import type { Database } from 'sql.js';

export const studentKnowledgeMasteryMigration = {
  id: '019_student_knowledge_mastery',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS student_knowledge_mastery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
      score_rate REAL,
      recent_score_rate REAL,
      weighted_score_earned REAL NOT NULL DEFAULT 0,
      weighted_score_possible REAL NOT NULL DEFAULT 0,
      question_count INTEGER NOT NULL DEFAULT 0,
      assessment_count INTEGER NOT NULL DEFAULT 0,
      mastery_level TEXT NOT NULL DEFAULT 'insufficient_data',
      last_assessed_at TEXT,
      calculation_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(student_id, course_id, knowledge_point_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS student_knowledge_mastery_student_course_idx ON student_knowledge_mastery(student_id, course_id, mastery_level)');
    database.run('CREATE INDEX IF NOT EXISTS student_knowledge_mastery_course_point_idx ON student_knowledge_mastery(course_id, knowledge_point_id, mastery_level)');
  },
};
