import type { Database } from 'sql.js';

function addStudentRole(database: Database): void {
  const result = database.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
  const usersSql = String(result[0]?.values[0]?.[0] ?? '');
  if (usersSql.includes("'student'")) return;

  database.run('PRAGMA foreign_keys = OFF');
  try {
    database.run('BEGIN');
    database.run(`CREATE TABLE users_mvp_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('teacher','student','admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run(`INSERT INTO users_mvp_new (id, username, email, password_hash, role, created_at)
      SELECT id, username, email, password_hash, role, created_at FROM users`);
    database.run('DROP TABLE users');
    database.run('ALTER TABLE users_mvp_new RENAME TO users');
    database.run('COMMIT');
  } catch (error) {
    try { database.run('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw error;
  } finally {
    database.run('PRAGMA foreign_keys = ON');
  }
}

export const examMvpFoundationMigration = {
  id: '002_exam_mvp_foundation',
  up(database: Database): void {
    addStudentRole(database);

    database.run(`CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      source_file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL,
      source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      source_question_no TEXT,
      type TEXT NOT NULL CHECK(type IN ('single_choice','multiple_choice','true_false','fill_blank','short_answer','calculation','essay')),
      stem TEXT NOT NULL,
      options TEXT,
      answer_key TEXT,
      analysis TEXT,
      scoring_rubric TEXT,
      default_score REAL NOT NULL DEFAULT 0 CHECK(default_score >= 0),
      difficulty TEXT CHECK(difficulty IS NULL OR difficulty IN ('basic','medium','hard')),
      knowledge_points TEXT,
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','reviewed','rejected')),
      ai_generated INTEGER NOT NULL DEFAULT 0 CHECK(ai_generated IN (0,1)),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS questions_owner_status_idx ON questions(created_by, status)');
    database.run('CREATE INDEX IF NOT EXISTS questions_source_file_idx ON questions(source_file_id)');
    database.run('CREATE UNIQUE INDEX IF NOT EXISTS questions_source_question_unique ON questions(source_file_id, source_question_no)');

    database.run(`CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      course TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK(duration_minutes > 0),
      total_score REAL NOT NULL DEFAULT 0 CHECK(total_score >= 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS papers_owner_status_idx ON papers(created_by, status)');

    database.run(`CREATE TABLE IF NOT EXISTS paper_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id),
      section_title TEXT,
      order_no INTEGER NOT NULL CHECK(order_no > 0),
      score REAL NOT NULL CHECK(score >= 0),
      question_snapshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(paper_id, order_no)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS paper_questions_paper_idx ON paper_questions(paper_id)');

    database.run(`CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL REFERENCES papers(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed')),
      start_at TEXT,
      end_at TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK(duration_minutes > 0),
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(start_at IS NULL OR end_at IS NULL OR start_at < end_at)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS exams_owner_status_idx ON exams(created_by, status)');

    database.run(`CREATE TABLE IF NOT EXISTS exam_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id),
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      due_at TEXT,
      UNIQUE(exam_id, student_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS exam_assignments_student_idx ON exam_assignments(student_id)');

    database.run(`CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id),
      assignment_id INTEGER NOT NULL REFERENCES exam_assignments(id),
      student_id INTEGER NOT NULL REFERENCES users(id),
      attempt_no INTEGER NOT NULL DEFAULT 1 CHECK(attempt_no > 0),
      status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','submitted','grading','graded')),
      started_at TEXT,
      expires_at TEXT,
      submitted_at TEXT,
      objective_score REAL NOT NULL DEFAULT 0 CHECK(objective_score >= 0),
      subjective_score REAL NOT NULL DEFAULT 0 CHECK(subjective_score >= 0),
      total_score REAL NOT NULL DEFAULT 0 CHECK(total_score >= 0),
      graded_by INTEGER REFERENCES users(id),
      graded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(exam_id, student_id, attempt_no)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS attempts_assignment_idx ON attempts(assignment_id)');

    database.run(`CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      paper_question_id INTEGER NOT NULL REFERENCES paper_questions(id),
      content TEXT,
      auto_score REAL CHECK(auto_score IS NULL OR auto_score >= 0),
      manual_score REAL CHECK(manual_score IS NULL OR manual_score >= 0),
      final_score REAL CHECK(final_score IS NULL OR final_score >= 0),
      is_correct INTEGER CHECK(is_correct IS NULL OR is_correct IN (0,1)),
      grading_status TEXT NOT NULL DEFAULT 'ungraded' CHECK(grading_status IN ('ungraded','auto_graded','manual_graded')),
      feedback TEXT,
      graded_by INTEGER REFERENCES users(id),
      graded_at TEXT,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(attempt_id, paper_question_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS answers_attempt_idx ON answers(attempt_id)');
  },
};
