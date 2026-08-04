import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { initialMigration } from '../src/db/migrations/001_initial.js';
import { examMvpFoundationMigration } from '../src/db/migrations/002_exam_mvp_foundation.js';
import { examDeliveryMigration } from '../src/db/migrations/003_exam_delivery.js';
import { gradingConfigMigration } from '../src/db/migrations/004_grading_config.js';
import { questionGenerationDomainMigration } from '../src/db/migrations/005_question_generation_domain.js';
import { promptAiRunMetadataMigration } from '../src/db/migrations/006_prompt_ai_run_metadata.js';

test('question generation migration preserves and links legacy data', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  for (const migration of [
    initialMigration,
    examMvpFoundationMigration,
    examDeliveryMigration,
    gradingConfigMigration,
  ]) migration.up(database);

  database.run("INSERT INTO users(id, username, email, password_hash, role) VALUES (7, 'legacy_teacher', 'legacy@example.com', 'hash', 'teacher')");
  database.run("INSERT INTO projects(id, title, course, user_id) VALUES (9, 'Legacy Exam', 'Advanced Math', 7)");
  database.run("INSERT INTO project_files(id, project_id, type, filename, filepath) VALUES (11, 9, 'past_paper', '2025.pdf', '/legacy/2025.pdf')");
  database.run("INSERT INTO project_files(id, project_id, type, filename, filepath) VALUES (12, 9, 'generated_paper', 'set-1.md', '/legacy/set-1.md')");
  database.run(`INSERT INTO questions(
    id, created_by, source_file_id, source_project_id, source_question_no,
    type, stem, answer_key, default_score, difficulty, status, ai_generated
  ) VALUES (13, 7, 11, 9, '1', 'short_answer', 'legacy stem', 'legacy answer', 5, 'medium', 'reviewed', 1)`);

  questionGenerationDomainMigration.up(database);

  assert.deepEqual(database.exec('SELECT id, title, course, user_id FROM projects')[0].values,
    [[9, 'Legacy Exam', 'Advanced Math', 7]]);
  assert.deepEqual(database.exec('SELECT id, stem, answer_key FROM questions')[0].values,
    [[13, 'legacy stem', 'legacy answer']]);
  assert.deepEqual(database.exec('SELECT owner_user_id, name, status FROM courses')[0].values,
    [[7, 'Advanced Math', 'legacy']]);
  assert.deepEqual(database.exec('SELECT project_file_id, filename, status FROM source_documents')[0].values,
    [[11, '2025.pdf', 'legacy']]);
  assert.deepEqual(database.exec(`SELECT legacy_question_id, provider, model, status
    FROM generated_questions`)[0].values,
    [[13, 'unknown-legacy', 'unknown-legacy', 'legacy']]);
  assert.deepEqual(database.exec('SELECT legacy_project_file_id, set_no, status FROM generated_papers')[0].values,
    [[12, 1, 'legacy']]);

  const projectCourseId = database.exec('SELECT course_id FROM projects WHERE id=9')[0].values[0][0];
  const courseId = database.exec('SELECT id FROM courses')[0].values[0][0];
  assert.equal(projectCourseId, courseId);

  const tables = new Set(database.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.flat().map(String));
  for (const name of [
    'courses', 'source_documents', 'source_exams', 'source_questions', 'knowledge_points',
    'question_classifications', 'exam_templates', 'blueprints', 'generation_plans',
    'generated_questions', 'generated_papers', 'rubrics', 'validation_reports',
    'export_artifacts', 'generation_jobs', 'prompt_versions', 'ai_runs',
  ]) assert.ok(tables.has(name), `missing table ${name}`);

  assert.equal(database.exec('PRAGMA foreign_key_check').length, 0);
  database.close();
});

test('prompt/AI run metadata migration backfills aliases without deleting legacy rows', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  for (const migration of [initialMigration, examMvpFoundationMigration, examDeliveryMigration, gradingConfigMigration, questionGenerationDomainMigration]) migration.up(database);
  promptAiRunMetadataMigration.up(database);
  const row = database.exec("SELECT key, prompt_id, stage, pipeline_stage, sha256, template_hash, schema_hash FROM prompt_versions WHERE key='legacy-unknown'")[0].values[0];
  assert.deepEqual(row, ['legacy-unknown', 'legacy-unknown', 'question_generation', 'question_generation', 'legacy-unknown', 'legacy-unknown', 'legacy-unknown']);
  const aiColumns = new Set(database.exec('PRAGMA table_info(ai_runs)')[0].values.map((item) => String(item[1])));
  for (const column of ['stage_run_id', 'model_parameters', 'input_hash', 'output_raw', 'output_parsed', 'error_type', 'retry_count', 'total_tokens', 'latency_ms', 'started_at', 'finished_at']) assert.ok(aiColumns.has(column));
  promptAiRunMetadataMigration.up(database);
  assert.equal(database.exec('PRAGMA foreign_key_check').length, 0);
  database.close();
});

test('question generation migration is safe to re-run', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  for (const migration of [
    initialMigration,
    examMvpFoundationMigration,
    examDeliveryMigration,
    gradingConfigMigration,
    questionGenerationDomainMigration,
    questionGenerationDomainMigration,
  ]) migration.up(database);

  assert.equal(database.exec("SELECT COUNT(*) FROM prompt_versions WHERE key='legacy-unknown' AND version='0'")[0].values[0][0], 1);
  assert.equal(database.exec('PRAGMA foreign_key_check').length, 0);
  database.close();
});
