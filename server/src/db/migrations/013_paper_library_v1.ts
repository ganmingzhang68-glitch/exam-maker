import type { Database } from 'sql.js';
function columns(database: Database, table: string): Set<string> { return new Set((database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1]))); }
export const paperLibraryV1Migration = {
  id: '013_paper_library_v1',
  up(database: Database): void {
    const existing = columns(database, 'papers');
    if (!existing.has('course_id')) database.run('ALTER TABLE papers ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL');
    if (!existing.has('creation_method')) database.run("ALTER TABLE papers ADD COLUMN creation_method TEXT NOT NULL DEFAULT 'manual'");
    database.run(`UPDATE papers SET course_id = (SELECT id FROM courses WHERE courses.owner_user_id=papers.created_by AND courses.name=papers.course LIMIT 1) WHERE course_id IS NULL`);
    database.run("UPDATE papers SET creation_method = CASE WHEN source_project_id IS NOT NULL THEN 'ai_generated' ELSE 'manual' END");
    database.run('CREATE INDEX IF NOT EXISTS papers_course_status_idx ON papers(course_id, status)');
  },
};
