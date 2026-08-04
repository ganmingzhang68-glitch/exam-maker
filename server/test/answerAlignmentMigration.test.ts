import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { initialMigration } from '../src/db/migrations/001_initial.js';
import { examMvpFoundationMigration } from '../src/db/migrations/002_exam_mvp_foundation.js';
import { examDeliveryMigration } from '../src/db/migrations/003_exam_delivery.js';
import { gradingConfigMigration } from '../src/db/migrations/004_grading_config.js';
import { questionGenerationDomainMigration } from '../src/db/migrations/005_question_generation_domain.js';
import { promptAiRunMetadataMigration } from '../src/db/migrations/006_prompt_ai_run_metadata.js';
import { answerAlignmentMigration } from '../src/db/migrations/007_answer_alignment.js';

test('answer alignment migration creates candidate and alignment stores idempotently', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  for (const migration of [initialMigration, examMvpFoundationMigration, examDeliveryMigration, gradingConfigMigration, questionGenerationDomainMigration, promptAiRunMetadataMigration, answerAlignmentMigration, answerAlignmentMigration]) migration.up(database);
  const tables = new Set(database.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.flat().map(String));
  assert.ok(tables.has('source_answer_candidates'));
  assert.ok(tables.has('question_answer_alignments'));
  assert.equal(database.exec('PRAGMA foreign_key_check').length, 0);
  database.close();
});
