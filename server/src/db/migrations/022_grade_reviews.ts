import type { Database } from 'sql.js';
export const gradeReviewsMigration = {
  id: '022_grade_reviews',
  up(database: Database): void {
    const columns = database.exec("PRAGMA table_info('exams')")[0]?.values.map(row => String(row[1])) ?? [];
    if (!columns.includes('grade_review_enabled')) database.run('ALTER TABLE exams ADD COLUMN grade_review_enabled INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('grade_review_deadline')) database.run('ALTER TABLE exams ADD COLUMN grade_review_deadline TEXT');
    database.run(`CREATE TABLE IF NOT EXISTS grade_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, answer_id INTEGER REFERENCES answers(id) ON DELETE SET NULL,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, evidence TEXT,
      status TEXT NOT NULL DEFAULT 'pending', resolution TEXT, resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run(`CREATE TABLE IF NOT EXISTS grade_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, grade_review_id INTEGER NOT NULL REFERENCES grade_reviews(id) ON DELETE CASCADE,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, action TEXT NOT NULL,
      before_json TEXT, after_json TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS grade_reviews_student_status_idx ON grade_reviews(student_id, status, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS grade_reviews_exam_status_idx ON grade_reviews(exam_id, status, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS grade_audit_logs_review_idx ON grade_audit_logs(grade_review_id, created_at)');
  },
};
