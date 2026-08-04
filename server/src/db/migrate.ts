import type { Database } from 'sql.js';
import { rawDb } from './index.js';
import { initialMigration } from './migrations/001_initial.js';
import { examMvpFoundationMigration } from './migrations/002_exam_mvp_foundation.js';
import { examDeliveryMigration } from './migrations/003_exam_delivery.js';
import { gradingConfigMigration } from './migrations/004_grading_config.js';
import { questionGenerationDomainMigration } from './migrations/005_question_generation_domain.js';
import { promptAiRunMetadataMigration } from './migrations/006_prompt_ai_run_metadata.js';
import { answerAlignmentMigration } from './migrations/007_answer_alignment.js';

interface Migration {
  id: string;
  up(database: Database): void;
}

const migrations: Migration[] = [
  initialMigration,
  examMvpFoundationMigration,
  examDeliveryMigration,
  gradingConfigMigration,
  questionGenerationDomainMigration,
  promptAiRunMetadataMigration,
  answerAlignmentMigration,
];

export function runMigrations(database: Database = rawDb): void {
  database.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const appliedResult = database.exec('SELECT id FROM schema_migrations');
  const applied = new Set(
    (appliedResult[0]?.values ?? []).map((row) => String(row[0]))
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    migration.up(database);
    database.run('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    console.log(`✅ Applied migration ${migration.id}`);
  }

  console.log('✅ Database migrations verified');
}
