import type { Database } from 'sql.js';

function columns(database: Database, table: string): Set<string> {
  return new Set((database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1])));
}

export const courseManagementMigration = {
  id: '010_course_management',
  up(database: Database): void {
    const existing = columns(database, 'courses');
    if (!existing.has('semester')) database.run('ALTER TABLE courses ADD COLUMN semester TEXT');
    if (!existing.has('instructor_name')) database.run('ALTER TABLE courses ADD COLUMN instructor_name TEXT');
    if (!existing.has('archived_at')) database.run('ALTER TABLE courses ADD COLUMN archived_at TEXT');

    // The generation-domain migration used `legacy` for imported rows. They are
    // usable courses, so normalize them without deleting or recreating data.
    database.run("UPDATE courses SET status = 'active' WHERE status = 'legacy'");
    database.run(`UPDATE courses
      SET instructor_name = (
        SELECT username FROM users WHERE users.id = courses.owner_user_id
      )
      WHERE instructor_name IS NULL OR trim(instructor_name) = ''`);
    database.run('CREATE INDEX IF NOT EXISTS courses_owner_status_idx ON courses(owner_user_id, status)');
  },
};
