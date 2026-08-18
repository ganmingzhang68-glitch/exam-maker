import type { Database } from 'sql.js';

export const secureExportArtifactsMigration = {
  id: '008_secure_export_artifacts',
  up(database: Database): void {
    const columns = new Set((database.exec('PRAGMA table_info(export_artifacts)')[0]?.values ?? []).map((row) => String(row[1])));
    if (columns.has('artifact_type')) return;
    database.run('PRAGMA foreign_keys = OFF');
    database.run('BEGIN');
    try {
      database.run('ALTER TABLE export_artifacts RENAME TO export_artifacts_legacy_008');
      database.run(`CREATE TABLE export_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generated_paper_id INTEGER NOT NULL REFERENCES generated_papers(id) ON DELETE CASCADE,
        paper_version INTEGER NOT NULL CHECK(paper_version > 0),
        artifact_type TEXT NOT NULL CHECK(artifact_type IN ('question_paper','answer_key','rubric','combined_teacher_package')),
        audience TEXT NOT NULL CHECK(audience IN ('student','teacher','grader','internal')),
        format TEXT NOT NULL CHECK(format IN ('markdown','latex','pdf','docx')),
        storage_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        renderer_version TEXT NOT NULL,
        source_paper_hash TEXT NOT NULL,
        integrity TEXT NOT NULL DEFAULT '{}',
        generation_status TEXT NOT NULL DEFAULT 'pending',
        validation_status TEXT NOT NULL DEFAULT 'pending',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(generated_paper_id, paper_version, artifact_type, audience, format, renderer_version)
      )`);
      database.run(`INSERT INTO export_artifacts(id, generated_paper_id, paper_version, artifact_type, audience, format,
        storage_path, sha256, content_hash, renderer_version, source_paper_hash, integrity, generation_status, validation_status, status, created_at, updated_at)
        SELECT id, generated_paper_id, paper_version,
          CASE WHEN audience='student' THEN 'question_paper' WHEN audience='rubric' THEN 'rubric' ELSE 'answer_key' END,
          CASE WHEN audience='student' THEN 'student' WHEN audience='rubric' THEN 'grader' ELSE 'teacher' END,
          format, storage_path, sha256, sha256, renderer_version, source_paper_hash, integrity, status, 'legacy_unverified', status, created_at, updated_at
        FROM export_artifacts_legacy_008`);
      database.run('DROP TABLE export_artifacts_legacy_008');
      database.run('CREATE INDEX export_artifacts_paper_audience_idx ON export_artifacts(generated_paper_id, audience)');
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    } finally {
      database.run('PRAGMA foreign_keys = ON');
    }
  },
};
