import type { Database } from 'sql.js';

export const answerAlignmentMigration = {
  id: '007_answer_alignment',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS source_answer_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
      page INTEGER,
      raw_number TEXT,
      normalized_number TEXT,
      answer_type TEXT NOT NULL,
      answer_content TEXT NOT NULL,
      explanation_content TEXT,
      score_information TEXT,
      source_text TEXT NOT NULL,
      extraction_confidence REAL NOT NULL DEFAULT 0 CHECK(extraction_confidence >= 0 AND extraction_confidence <= 1),
      status TEXT NOT NULL DEFAULT 'extracted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS source_answer_candidates_document_number_idx ON source_answer_candidates(source_document_id, normalized_number)');
    database.run(`CREATE TABLE IF NOT EXISTS question_answer_alignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_question_id INTEGER NOT NULL REFERENCES source_questions(id) ON DELETE CASCADE,
      source_answer_candidate_id INTEGER REFERENCES source_answer_candidates(id) ON DELETE SET NULL,
      generation_stage_run_id INTEGER REFERENCES generation_job_stages(id) ON DELETE SET NULL,
      alignment_status TEXT NOT NULL CHECK(alignment_status IN ('matched','uncertain','missing_answer','duplicate_candidate','conflicting_candidates')),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      reason TEXT NOT NULL,
      normalized_answer TEXT,
      requires_teacher_review INTEGER NOT NULL DEFAULT 1 CHECK(requires_teacher_review IN (0,1)),
      source_evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS question_answer_alignments_question_idx ON question_answer_alignments(source_question_id, status)');
  },
};
