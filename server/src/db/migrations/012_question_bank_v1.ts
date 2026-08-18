import type { Database } from 'sql.js';

function columns(database: Database, table: string): Set<string> {
  return new Set((database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1])));
}

export const questionBankV1Migration = {
  id: '012_question_bank_v1',
  up(database: Database): void {
    const existing = columns(database, 'questions');
    if (!existing.has('course_id')) database.run('ALTER TABLE questions ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL');
    if (!existing.has('origin')) database.run("ALTER TABLE questions ADD COLUMN origin TEXT NOT NULL DEFAULT 'teacher_created'");
    if (!existing.has('lifecycle_status')) database.run("ALTER TABLE questions ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'draft'");
    database.run(`UPDATE questions SET course_id = (
      SELECT course_id FROM projects WHERE projects.id = questions.source_project_id
    ) WHERE course_id IS NULL AND source_project_id IS NOT NULL`);
    database.run("UPDATE questions SET origin = CASE WHEN ai_generated = 1 THEN 'ai_generated' WHEN source_file_id IS NOT NULL THEN 'past_exam' ELSE 'teacher_created' END");
    database.run("UPDATE questions SET lifecycle_status = CASE WHEN status='reviewed' THEN 'approved' WHEN status='rejected' THEN 'archived' ELSE 'draft' END");
    database.run('CREATE INDEX IF NOT EXISTS questions_course_lifecycle_idx ON questions(course_id, lifecycle_status)');
    database.run(`CREATE TABLE IF NOT EXISTS question_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      change_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(question_id, version_no)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS question_versions_question_idx ON question_versions(question_id, version_no)');
  },
};
