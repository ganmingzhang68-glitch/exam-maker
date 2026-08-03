import type { Database } from 'sql.js';

function hasColumn(database: Database, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  return (result[0]?.values ?? []).some((row) => String(row[1]) === column);
}

export const questionGenerationDomainMigration = {
  id: '005_question_generation_domain',
  up(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      code TEXT,
      name TEXT NOT NULL,
      description TEXT,
      material_document_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, name)
    )`);

    if (!hasColumn(database, 'projects', 'course_id')) {
      database.run('ALTER TABLE projects ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL');
    }

    database.run(`INSERT OR IGNORE INTO courses(owner_user_id, name, status, created_at, updated_at)
      SELECT DISTINCT user_id, course, 'legacy', created_at, updated_at
      FROM projects WHERE trim(course) <> ''`);
    database.run(`UPDATE projects SET course_id = (
      SELECT c.id FROM courses c
      WHERE c.owner_user_id = projects.user_id AND c.name = projects.course
    ) WHERE course_id IS NULL`);

    database.run(`CREATE TABLE IF NOT EXISTS prompt_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      version TEXT NOT NULL,
      stage TEXT NOT NULL,
      template TEXT NOT NULL,
      input_schema_version TEXT NOT NULL,
      output_schema_version TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(key, version)
    )`);
    database.run(`INSERT OR IGNORE INTO prompt_versions(
      key, version, stage, template, input_schema_version, output_schema_version,
      sha256, notes, status
    ) VALUES (
      'legacy-unknown', '0', 'question_generation', '', 'legacy', 'legacy',
      'legacy-unknown', 'Compatibility record for pre-pipeline AI output', 'legacy'
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS generation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      pipeline_version TEXT NOT NULL,
      current_stage TEXT,
      last_successful_stage TEXT,
      number_of_sets INTEGER NOT NULL DEFAULT 1 CHECK(number_of_sets > 0 AND number_of_sets <= 50),
      error_summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS generation_jobs_project_status_idx ON generation_jobs(project_id, status)');

    database.run(`CREATE TABLE IF NOT EXISTS generation_job_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1 CHECK(attempt_no > 0),
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT,
      input_artifact_id INTEGER,
      output_artifact_id INTEGER,
      error_code TEXT,
      error_message TEXT,
      error_stack TEXT,
      retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
      started_at TEXT,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','needs_review','succeeded','failed','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(generation_job_id, stage, attempt_no)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS generation_job_stages_job_status_idx ON generation_job_stages(generation_job_id, status)');

    database.run(`CREATE TABLE IF NOT EXISTS ai_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_job_id INTEGER REFERENCES generation_jobs(id) ON DELETE SET NULL,
      stage TEXT NOT NULL,
      prompt_version_id INTEGER NOT NULL REFERENCES prompt_versions(id),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      parameters TEXT NOT NULL DEFAULT '{}',
      input_artifact_id INTEGER,
      output_artifact_id INTEGER,
      request_id TEXT,
      input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
      output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
      error_message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS ai_runs_job_stage_idx ON ai_runs(generation_job_id, stage)');

    database.run(`CREATE TABLE IF NOT EXISTS source_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      project_file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL UNIQUE,
      document_kind TEXT NOT NULL DEFAULT 'exam' CHECK(document_kind IN ('exam','answer','exam_with_answer','syllabus','material')),
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      sha256 TEXT NOT NULL,
      page_count INTEGER CHECK(page_count IS NULL OR page_count >= 0),
      extraction_confidence REAL CHECK(extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS source_documents_project_status_idx ON source_documents(project_id, status)');

    database.run(`INSERT OR IGNORE INTO source_documents(
      project_id, course_id, project_file_id, document_kind, filename, storage_path,
      mime_type, sha256, metadata, status, created_at, updated_at
    ) SELECT
      pf.project_id, p.course_id, pf.id, 'exam', pf.filename, pf.filepath,
      NULL, 'legacy-project-file-' || pf.id, COALESCE(pf.metadata, '{}'), 'legacy',
      pf.created_at, pf.created_at
    FROM project_files pf JOIN projects p ON p.id = pf.project_id
    WHERE pf.type = 'past_paper' AND p.course_id IS NOT NULL`);

    database.run(`CREATE TABLE IF NOT EXISTS source_exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      academic_year TEXT,
      term TEXT,
      paper_variant TEXT,
      total_score REAL CHECK(total_score IS NULL OR total_score >= 0),
      duration_minutes INTEGER CHECK(duration_minutes IS NULL OR duration_minutes > 0),
      instructions TEXT NOT NULL DEFAULT '[]',
      structure TEXT NOT NULL DEFAULT '{}',
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS source_exams_document_idx ON source_exams(source_document_id)');

    database.run(`CREATE TABLE IF NOT EXISTS source_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_exam_id INTEGER NOT NULL REFERENCES source_exams(id) ON DELETE CASCADE,
      source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
      page_start INTEGER CHECK(page_start IS NULL OR page_start > 0),
      page_end INTEGER CHECK(page_end IS NULL OR page_end > 0),
      original_question_no TEXT NOT NULL,
      raw_stem TEXT NOT NULL,
      normalized_stem TEXT NOT NULL DEFAULT '[]',
      question_type TEXT NOT NULL,
      options TEXT,
      subquestions TEXT NOT NULL DEFAULT '[]',
      original_score REAL CHECK(original_score IS NULL OR original_score >= 0),
      raw_answer TEXT,
      raw_analysis TEXT,
      content_references TEXT NOT NULL DEFAULT '[]',
      extraction_confidence REAL NOT NULL DEFAULT 0 CHECK(extraction_confidence >= 0 AND extraction_confidence <= 1),
      teacher_review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(teacher_review_status IN ('unreviewed','needs_alignment','confirmed','rejected')),
      alignment_confidence REAL CHECK(alignment_confidence IS NULL OR (alignment_confidence >= 0 AND alignment_confidence <= 1)),
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_exam_id, original_question_no)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS source_questions_review_idx ON source_questions(source_exam_id, teacher_review_status)');

    database.run(`CREATE TABLE IF NOT EXISTS knowledge_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES knowledge_points(id) ON DELETE SET NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      aliases TEXT NOT NULL DEFAULT '[]',
      is_locked INTEGER NOT NULL DEFAULT 0 CHECK(is_locked IN (0,1)),
      locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      locked_at TEXT,
      merged_into_id INTEGER REFERENCES knowledge_points(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(course_id, code)
    )`);
    database.run('CREATE INDEX IF NOT EXISTS knowledge_points_parent_idx ON knowledge_points(course_id, parent_id)');

    database.run(`CREATE TABLE IF NOT EXISTS exam_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      assessment_template TEXT NOT NULL,
      rendering_template TEXT NOT NULL,
      source_exam_ids TEXT NOT NULL DEFAULT '[]',
      is_teacher_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(is_teacher_confirmed IN (0,1)),
      legacy_project_file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL,
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, version)
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS blueprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('historical','target','actual')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      total_score REAL NOT NULL CHECK(total_score > 0),
      source_exam_ids TEXT NOT NULL DEFAULT '[]',
      historical_blueprint_id INTEGER REFERENCES blueprints(id) ON DELETE SET NULL,
      target_blueprint_id INTEGER REFERENCES blueprints(id) ON DELETE SET NULL,
      generated_paper_id INTEGER,
      teacher_notes TEXT,
      is_teacher_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(is_teacher_confirmed IN (0,1)),
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, kind, version)
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS blueprint_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blueprint_id INTEGER NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
      knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id),
      question_type TEXT NOT NULL,
      cognitive_level TEXT NOT NULL,
      difficulty_level TEXT NOT NULL CHECK(difficulty_level IN ('basic','medium','hard')),
      question_count INTEGER NOT NULL DEFAULT 0 CHECK(question_count >= 0),
      score REAL NOT NULL DEFAULT 0 CHECK(score >= 0),
      score_ratio REAL NOT NULL DEFAULT 0 CHECK(score_ratio >= 0 AND score_ratio <= 1),
      tolerance REAL CHECK(tolerance IS NULL OR (tolerance >= 0 AND tolerance <= 1)),
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blueprint_id, knowledge_point_id, question_type, cognitive_level, difficulty_level)
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS generation_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      exam_template_id INTEGER NOT NULL REFERENCES exam_templates(id),
      target_blueprint_id INTEGER NOT NULL REFERENCES blueprints(id),
      number_of_sets INTEGER NOT NULL DEFAULT 1 CHECK(number_of_sets > 0 AND number_of_sets <= 50),
      total_score_per_set REAL NOT NULL CHECK(total_score_per_set > 0),
      is_teacher_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(is_teacher_confirmed IN (0,1)),
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS generation_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_plan_id INTEGER NOT NULL REFERENCES generation_plans(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL,
      set_no INTEGER NOT NULL CHECK(set_no > 0),
      section_id TEXT NOT NULL,
      order_no INTEGER NOT NULL CHECK(order_no > 0),
      knowledge_point_ids TEXT NOT NULL,
      question_type TEXT NOT NULL,
      score REAL NOT NULL CHECK(score > 0),
      difficulty TEXT NOT NULL,
      cognitive_level TEXT NOT NULL,
      expected_answer_kind TEXT NOT NULL,
      content_requirements TEXT NOT NULL DEFAULT '{}',
      corresponding_slot_key TEXT,
      source_material_document_ids TEXT NOT NULL DEFAULT '[]',
      forbidden_source_question_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(generation_plan_id, set_no, slot_key)
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS generated_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_plan_id INTEGER REFERENCES generation_plans(id) ON DELETE SET NULL,
      generation_plan_item_id INTEGER REFERENCES generation_plan_items(id) ON DELETE SET NULL,
      legacy_question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL UNIQUE,
      set_no INTEGER NOT NULL DEFAULT 1 CHECK(set_no > 0),
      question_type TEXT NOT NULL,
      stem TEXT NOT NULL DEFAULT '[]',
      options TEXT,
      subquestions TEXT NOT NULL DEFAULT '[]',
      score REAL NOT NULL DEFAULT 0 CHECK(score >= 0),
      answer TEXT,
      explanation TEXT NOT NULL DEFAULT '[]',
      knowledge_point_ids TEXT NOT NULL DEFAULT '[]',
      cognitive_level TEXT,
      difficulty TEXT,
      source_question_ids TEXT NOT NULL DEFAULT '[]',
      provider TEXT NOT NULL DEFAULT 'unknown-legacy',
      model TEXT NOT NULL DEFAULT 'unknown-legacy',
      prompt_version_id INTEGER NOT NULL REFERENCES prompt_versions(id),
      generation_parameters TEXT NOT NULL DEFAULT '{}',
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS generated_questions_plan_item_idx ON generated_questions(generation_plan_item_id)');

    database.run(`INSERT OR IGNORE INTO generated_questions(
      legacy_question_id, set_no, question_type, stem, score, answer, explanation,
      provider, model, prompt_version_id, generation_parameters, status, created_at, updated_at
    ) SELECT
      q.id, 1, q.type, '[]', q.default_score, q.answer_key, '[]',
      'unknown-legacy', 'unknown-legacy', pv.id, '{}', 'legacy', q.created_at, q.updated_at
    FROM questions q CROSS JOIN prompt_versions pv
    WHERE q.ai_generated = 1 AND pv.key = 'legacy-unknown' AND pv.version = '0'`);

    database.run(`CREATE TABLE IF NOT EXISTS question_classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_kind TEXT NOT NULL CHECK(question_kind IN ('source','generated')),
      source_question_id INTEGER REFERENCES source_questions(id) ON DELETE CASCADE,
      generated_question_id INTEGER REFERENCES generated_questions(id) ON DELETE CASCADE,
      knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id),
      role TEXT NOT NULL CHECK(role IN ('primary','secondary')),
      cognitive_level TEXT NOT NULL,
      difficulty_level TEXT NOT NULL CHECK(difficulty_level IN ('basic','medium','hard')),
      difficulty_score REAL NOT NULL CHECK(difficulty_score >= 0 AND difficulty_score <= 1),
      difficulty_source TEXT NOT NULL CHECK(difficulty_source IN ('predicted','teacher_adjusted','empirical')),
      difficulty_reason TEXT NOT NULL,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      empirical_sample_size INTEGER,
      is_teacher_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(is_teacher_confirmed IN (0,1)),
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(
        (question_kind = 'source' AND source_question_id IS NOT NULL AND generated_question_id IS NULL) OR
        (question_kind = 'generated' AND generated_question_id IS NOT NULL AND source_question_id IS NULL)
      ),
      CHECK(difficulty_source <> 'empirical' OR empirical_sample_size > 0),
      UNIQUE(source_question_id, knowledge_point_id),
      UNIQUE(generated_question_id, knowledge_point_id)
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS rubrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_question_id INTEGER NOT NULL REFERENCES generated_questions(id) ON DELETE CASCADE UNIQUE,
      total_score REAL NOT NULL CHECK(total_score > 0),
      items TEXT NOT NULL,
      general_rule TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version_id INTEGER NOT NULL REFERENCES prompt_versions(id),
      generation_parameters TEXT NOT NULL DEFAULT '{}',
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS generated_papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_plan_id INTEGER REFERENCES generation_plans(id) ON DELETE SET NULL,
      generation_job_id INTEGER REFERENCES generation_jobs(id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
      legacy_project_file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL UNIQUE,
      set_no INTEGER NOT NULL DEFAULT 1 CHECK(set_no > 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK(duration_minutes > 0),
      total_score REAL NOT NULL DEFAULT 0 CHECK(total_score >= 0),
      instructions TEXT NOT NULL DEFAULT '[]',
      canonical_json TEXT NOT NULL DEFAULT '{}',
      actual_blueprint_id INTEGER REFERENCES blueprints(id) ON DELETE SET NULL,
      validation_report_id INTEGER,
      selected_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(generation_plan_id, set_no, version)
    )`);

    database.run(`INSERT OR IGNORE INTO generated_papers(
      course_id, legacy_project_file_id, set_no, version, title, canonical_json,
      status, created_at, updated_at
    ) SELECT
      p.course_id, pf.id,
      1,
      1, pf.filename, '{}', 'legacy', pf.created_at, pf.created_at
    FROM project_files pf JOIN projects p ON p.id = pf.project_id
    WHERE pf.type = 'generated_paper'`);

    database.run(`CREATE TABLE IF NOT EXISTS generated_paper_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_paper_id INTEGER NOT NULL REFERENCES generated_papers(id) ON DELETE CASCADE,
      generated_question_id INTEGER NOT NULL REFERENCES generated_questions(id),
      section_id TEXT NOT NULL,
      section_title TEXT NOT NULL,
      order_no INTEGER NOT NULL CHECK(order_no > 0),
      score REAL NOT NULL CHECK(score >= 0),
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(generated_paper_id, order_no)
    )`);

    database.run(`CREATE TABLE IF NOT EXISTS validation_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_paper_id INTEGER NOT NULL REFERENCES generated_papers(id) ON DELETE CASCADE,
      target_blueprint_id INTEGER REFERENCES blueprints(id) ON DELETE SET NULL,
      actual_blueprint_id INTEGER REFERENCES blueprints(id) ON DELETE SET NULL,
      passed INTEGER NOT NULL DEFAULT 0 CHECK(passed IN (0,1)),
      findings TEXT NOT NULL DEFAULT '[]',
      metrics TEXT NOT NULL DEFAULT '{}',
      validator_version TEXT NOT NULL,
      ai_run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    database.run('CREATE INDEX IF NOT EXISTS validation_reports_paper_idx ON validation_reports(generated_paper_id)');

    database.run(`CREATE TABLE IF NOT EXISTS export_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_paper_id INTEGER NOT NULL REFERENCES generated_papers(id) ON DELETE CASCADE,
      paper_version INTEGER NOT NULL CHECK(paper_version > 0),
      audience TEXT NOT NULL CHECK(audience IN ('student','teacher','answer','rubric')),
      format TEXT NOT NULL CHECK(format IN ('markdown','latex','pdf','docx')),
      storage_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      renderer_version TEXT NOT NULL,
      source_paper_hash TEXT NOT NULL,
      integrity TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(generated_paper_id, paper_version, audience, format, renderer_version)
    )`);
  },
};
