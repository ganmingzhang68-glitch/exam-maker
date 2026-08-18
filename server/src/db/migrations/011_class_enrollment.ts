import type { Database } from 'sql.js';

export const classEnrollmentMigration = {
  id: '011_class_enrollment',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS teaching_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      teacher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      semester TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(course_id, name)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS teaching_classes_teacher_status_idx ON teaching_classes(teacher_user_id, status)');
    database.run('CREATE INDEX IF NOT EXISTS teaching_classes_course_idx ON teaching_classes(course_id)');

    database.run(`CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES teaching_classes(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      removed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(class_id, student_id)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS enrollments_class_status_idx ON enrollments(class_id, status)');
    database.run('CREATE INDEX IF NOT EXISTS enrollments_student_status_idx ON enrollments(student_id, status)');
  },
};
