import type { Database } from 'sql.js';
import { rawDb } from './index.js';
import { initialMigration } from './migrations/001_initial.js';
import { examMvpFoundationMigration } from './migrations/002_exam_mvp_foundation.js';
import { examDeliveryMigration } from './migrations/003_exam_delivery.js';
import { gradingConfigMigration } from './migrations/004_grading_config.js';
import { questionGenerationDomainMigration } from './migrations/005_question_generation_domain.js';
import { promptAiRunMetadataMigration } from './migrations/006_prompt_ai_run_metadata.js';
import { answerAlignmentMigration } from './migrations/007_answer_alignment.js';
import { secureExportArtifactsMigration } from './migrations/008_secure_export_artifacts.js';
import { similarQuestionPipelineMigration } from './migrations/009_similar_question_pipeline.js';
import { courseManagementMigration } from './migrations/010_course_management.js';
import { classEnrollmentMigration } from './migrations/011_class_enrollment.js';
import { questionBankV1Migration } from './migrations/012_question_bank_v1.js';
import { paperLibraryV1Migration } from './migrations/013_paper_library_v1.js';
import { productionJobsMigration } from './migrations/014_production_jobs.js';
import { questionQualityReportsMigration } from './migrations/015_question_quality_reports.js';
import { difficultyCalibrationMigration } from './migrations/016_difficulty_calibration.js';

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
  secureExportArtifactsMigration,
  similarQuestionPipelineMigration,
  courseManagementMigration,
  classEnrollmentMigration,
  questionBankV1Migration,
  paperLibraryV1Migration,
  productionJobsMigration,
  questionQualityReportsMigration,
  difficultyCalibrationMigration,
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
