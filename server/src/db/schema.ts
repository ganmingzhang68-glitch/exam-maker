import { sqliteTable, text, integer, real, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['teacher', 'student', 'admin'] }).notNull().default('student'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerUserId: integer('owner_user_id').notNull().references(() => users.id),
  code: text('code'),
  name: text('name').notNull(),
  semester: text('semester'),
  description: text('description'),
  instructorName: text('instructor_name'),
  materialDocumentIds: text('material_document_ids').notNull().default('[]'),
  status: text('status').notNull().default('draft'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  ownerNameUnique: uniqueIndex('courses_owner_name_unique').on(table.ownerUserId, table.name),
}));

export const teachingClasses = sqliteTable('teaching_classes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'restrict' }),
  teacherUserId: integer('teacher_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  semester: text('semester'),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  courseNameUnique: uniqueIndex('teaching_classes_course_name_unique').on(table.courseId, table.name),
  teacherStatusIdx: index('teaching_classes_teacher_status_idx').on(table.teacherUserId, table.status),
}));

export const enrollments = sqliteTable('enrollments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  classId: integer('class_id').notNull().references(() => teachingClasses.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: text('status', { enum: ['active', 'removed'] }).notNull().default('active'),
  joinedAt: text('joined_at').notNull().default(sql`(datetime('now'))`),
  removedAt: text('removed_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  classStudentUnique: uniqueIndex('enrollments_class_student_unique').on(table.classId, table.studentId),
  classStatusIdx: index('enrollments_class_status_idx').on(table.classId, table.status),
  studentStatusIdx: index('enrollments_student_status_idx').on(table.studentId, table.status),
}));

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  course: text('course').notNull(),
  scope: text('scope'),
  difficulty: text('difficulty').notNull().default('{"basic":60,"medium":30,"hard":10}'),
  nSets: integer('n_sets').notNull().default(8),
  outputType: text('output_type', { enum: ['latex', 'docx', 'md'] }).notNull().default('latex'),
  verifyMode: text('verify_mode', { enum: ['auto', 'computational', 'conceptual', 'mixed'] }).notNull().default('auto'),
  status: text('status').notNull().default('drafting'),
  userId: integer('user_id').notNull().references(() => users.id),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const projectFiles = sqliteTable('project_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  type: text('type').notNull(),
  filename: text('filename').notNull(),
  filepath: text('filepath').notNull(),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const checkpoints = sqliteTable('checkpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  step: text('step').notNull(),
  status: text('status').notNull().default('pending'),
  teacherNotes: text('teacher_notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const jobEvents = sqliteTable('job_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  step: text('step').notNull(),
  eventType: text('event_type').notNull(),
  message: text('message').notNull(),
  data: text('data'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const promptVersions = sqliteTable('prompt_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  version: text('version').notNull(),
  stage: text('stage').notNull(),
  template: text('template').notNull(),
  inputSchemaVersion: text('input_schema_version').notNull(),
  outputSchemaVersion: text('output_schema_version').notNull(),
  sha256: text('sha256').notNull(),
  promptId: text('prompt_id'),
  pipelineStage: text('pipeline_stage'),
  templateHash: text('template_hash'),
  schemaHash: text('schema_hash'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  keyVersionUnique: uniqueIndex('prompt_versions_key_version_unique').on(table.key, table.version),
}));

export const generationJobs = sqliteTable('generation_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  courseId: integer('course_id').notNull().references(() => courses.id),
  requestedBy: integer('requested_by').notNull().references(() => users.id),
  pipelineVersion: text('pipeline_version').notNull(),
  currentStage: text('current_stage'),
  lastSuccessfulStage: text('last_successful_stage'),
  numberOfSets: integer('number_of_sets').notNull().default(1),
  errorSummary: text('error_summary'),
  taskStatus: text('task_status'),
  requestId: text('request_id'),
  idempotencyKey: text('idempotency_key'),
  cancelRequestedAt: text('cancel_requested_at'),
  finishedAt: text('finished_at'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  projectStatusIdx: index('generation_jobs_project_status_idx').on(table.projectId, table.status),
}));

export const generationJobStages = sqliteTable('generation_job_stages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationJobId: integer('generation_job_id').notNull().references(() => generationJobs.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  attemptNo: integer('attempt_no').notNull().default(1),
  inputJson: text('input_json').notNull().default('{}'),
  outputJson: text('output_json'),
  inputArtifactId: integer('input_artifact_id'),
  outputArtifactId: integer('output_artifact_id'),
  inputArtifactIds: text('input_artifact_ids').notNull().default('[]'),
  outputArtifactIds: text('output_artifact_ids').notNull().default('[]'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  stageAttemptUnique: uniqueIndex('generation_job_stages_attempt_unique')
    .on(table.generationJobId, table.stage, table.attemptNo),
  jobStatusIdx: index('generation_job_stages_job_status_idx').on(table.generationJobId, table.status),
}));

export const similarQuestionJobs = sqliteTable('similar_question_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestedBy: integer('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  course: text('course').notNull(),
  scope: text('scope'),
  sourceText: text('source_text').notNull(),
  sourceAnswer: text('source_answer'),
  variantsPerQuestion: integer('variants_per_question').notNull().default(1),
  defaultScore: real('default_score').notNull().default(10),
  difficultyMode: text('difficulty_mode', { enum: ['same', 'lower', 'higher'] }).notNull().default('same'),
  currentStage: text('current_stage'),
  lastSuccessfulStage: text('last_successful_stage'),
  errorSummary: text('error_summary'),
  resultJson: text('result_json'),
  taskStatus: text('task_status'),
  requestId: text('request_id'),
  idempotencyKey: text('idempotency_key'),
  cancelRequestedAt: text('cancel_requested_at'),
  finishedAt: text('finished_at'),
  status: text('status', { enum: ['pending', 'running', 'succeeded', 'failed', 'saved'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  ownerStatusIdx: index('similar_question_jobs_owner_status_idx').on(table.requestedBy, table.status),
}));

export const similarQuestionJobStages = sqliteTable('similar_question_job_stages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => similarQuestionJobs.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  attemptNo: integer('attempt_no').notNull().default(1),
  inputJson: text('input_json').notNull().default('{}'),
  outputJson: text('output_json'),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull().default('running'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  stageAttemptUnique: uniqueIndex('similar_question_job_stages_attempt_unique').on(table.jobId, table.stage, table.attemptNo),
  jobStatusIdx: index('similar_question_job_stages_job_status_idx').on(table.jobId, table.status),
}));

export const aiRuns = sqliteTable('ai_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationJobId: integer('generation_job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  similarQuestionJobId: integer('similar_question_job_id').references(() => similarQuestionJobs.id, { onDelete: 'set null' }),
  stageRunId: integer('stage_run_id').references(() => generationJobStages.id, { onDelete: 'set null' }),
  stage: text('stage').notNull(),
  promptVersionId: integer('prompt_version_id').notNull().references(() => promptVersions.id),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  parameters: text('parameters').notNull().default('{}'),
  modelParameters: text('model_parameters').notNull().default('{}'),
  inputHash: text('input_hash'),
  outputRaw: text('output_raw'),
  outputParsed: text('output_parsed'),
  inputArtifactId: integer('input_artifact_id'),
  outputArtifactId: integer('output_artifact_id'),
  requestId: text('request_id'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  latencyMs: integer('latency_ms'),
  errorType: text('error_type'),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  jobStageIdx: index('ai_runs_job_stage_idx').on(table.generationJobId, table.stage),
}));

export const sourceDocuments = sqliteTable('source_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  courseId: integer('course_id').notNull().references(() => courses.id),
  projectFileId: integer('project_file_id').references(() => projectFiles.id, { onDelete: 'set null' }),
  documentKind: text('document_kind').notNull().default('exam'),
  filename: text('filename').notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type'),
  sha256: text('sha256').notNull(),
  pageCount: integer('page_count'),
  extractionConfidence: real('extraction_confidence'),
  metadata: text('metadata').notNull().default('{}'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  projectFileUnique: uniqueIndex('source_documents_project_file_unique').on(table.projectFileId),
  projectStatusIdx: index('source_documents_project_status_idx').on(table.projectId, table.status),
}));

export const sourceExams = sqliteTable('source_exams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id),
  sourceDocumentId: integer('source_document_id').notNull().references(() => sourceDocuments.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  academicYear: text('academic_year'),
  term: text('term'),
  paperVariant: text('paper_variant'),
  totalScore: real('total_score'),
  durationMinutes: integer('duration_minutes'),
  instructions: text('instructions').notNull().default('[]'),
  structure: text('structure').notNull().default('{}'),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  documentIdx: index('source_exams_document_idx').on(table.sourceDocumentId),
}));

export const sourceQuestions = sqliteTable('source_questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceExamId: integer('source_exam_id').notNull().references(() => sourceExams.id, { onDelete: 'cascade' }),
  sourceDocumentId: integer('source_document_id').notNull().references(() => sourceDocuments.id, { onDelete: 'cascade' }),
  pageStart: integer('page_start'),
  pageEnd: integer('page_end'),
  originalQuestionNo: text('original_question_no').notNull(),
  rawStem: text('raw_stem').notNull(),
  normalizedStem: text('normalized_stem').notNull().default('[]'),
  questionType: text('question_type').notNull(),
  options: text('options'),
  subquestions: text('subquestions').notNull().default('[]'),
  originalScore: real('original_score'),
  rawAnswer: text('raw_answer'),
  rawAnalysis: text('raw_analysis'),
  contentReferences: text('content_references').notNull().default('[]'),
  extractionConfidence: real('extraction_confidence').notNull().default(0),
  teacherReviewStatus: text('teacher_review_status').notNull().default('unreviewed'),
  alignmentConfidence: real('alignment_confidence'),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  examQuestionUnique: uniqueIndex('source_questions_exam_number_unique')
    .on(table.sourceExamId, table.originalQuestionNo),
  reviewIdx: index('source_questions_review_idx').on(table.sourceExamId, table.teacherReviewStatus),
}));

export const sourceAnswerCandidates = sqliteTable('source_answer_candidates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceDocumentId: integer('source_document_id').notNull().references(() => sourceDocuments.id, { onDelete: 'cascade' }),
  page: integer('page'),
  rawNumber: text('raw_number'),
  normalizedNumber: text('normalized_number'),
  answerType: text('answer_type').notNull(),
  answerContent: text('answer_content').notNull(),
  explanationContent: text('explanation_content'),
  scoreInformation: text('score_information'),
  sourceText: text('source_text').notNull(),
  extractionConfidence: real('extraction_confidence').notNull().default(0),
  status: text('status').notNull().default('extracted'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  documentNumberIdx: index('source_answer_candidates_document_number_idx').on(table.sourceDocumentId, table.normalizedNumber),
}));

export const questionAnswerAlignments = sqliteTable('question_answer_alignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceQuestionId: integer('source_question_id').notNull().references(() => sourceQuestions.id, { onDelete: 'cascade' }),
  sourceAnswerCandidateId: integer('source_answer_candidate_id').references(() => sourceAnswerCandidates.id, { onDelete: 'set null' }),
  generationStageRunId: integer('generation_stage_run_id').references(() => generationJobStages.id, { onDelete: 'set null' }),
  alignmentStatus: text('alignment_status', { enum: ['matched', 'uncertain', 'missing_answer', 'duplicate_candidate', 'conflicting_candidates'] }).notNull(),
  confidence: real('confidence').notNull(),
  reason: text('reason').notNull(),
  normalizedAnswer: text('normalized_answer'),
  requiresTeacherReview: integer('requires_teacher_review', { mode: 'boolean' }).notNull().default(true),
  sourceEvidence: text('source_evidence').notNull().default('[]'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  questionIdx: index('question_answer_alignments_question_idx').on(table.sourceQuestionId, table.status),
}));

export const knowledgePoints = sqliteTable('knowledge_points', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): AnySQLiteColumn => knowledgePoints.id, { onDelete: 'set null' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  aliases: text('aliases').notNull().default('[]'),
  isLocked: integer('is_locked', { mode: 'boolean' }).notNull().default(false),
  lockedBy: integer('locked_by').references(() => users.id, { onDelete: 'set null' }),
  lockedAt: text('locked_at'),
  mergedIntoId: integer('merged_into_id').references((): AnySQLiteColumn => knowledgePoints.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  courseCodeUnique: uniqueIndex('knowledge_points_course_code_unique').on(table.courseId, table.code),
  parentIdx: index('knowledge_points_parent_idx').on(table.courseId, table.parentId),
}));

export const examTemplates = sqliteTable('exam_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  assessmentTemplate: text('assessment_template').notNull(),
  renderingTemplate: text('rendering_template').notNull(),
  sourceExamIds: text('source_exam_ids').notNull().default('[]'),
  isTeacherConfirmed: integer('is_teacher_confirmed', { mode: 'boolean' }).notNull().default(false),
  legacyProjectFileId: integer('legacy_project_file_id').references(() => projectFiles.id, { onDelete: 'set null' }),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  projectVersionUnique: uniqueIndex('exam_templates_project_version_unique').on(table.projectId, table.version),
}));

export const blueprints = sqliteTable('blueprints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['historical', 'target', 'actual'] }).notNull(),
  version: integer('version').notNull().default(1),
  totalScore: real('total_score').notNull(),
  sourceExamIds: text('source_exam_ids').notNull().default('[]'),
  historicalBlueprintId: integer('historical_blueprint_id').references((): AnySQLiteColumn => blueprints.id, { onDelete: 'set null' }),
  targetBlueprintId: integer('target_blueprint_id').references((): AnySQLiteColumn => blueprints.id, { onDelete: 'set null' }),
  generatedPaperId: integer('generated_paper_id'),
  teacherNotes: text('teacher_notes'),
  isTeacherConfirmed: integer('is_teacher_confirmed', { mode: 'boolean' }).notNull().default(false),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  projectKindVersionUnique: uniqueIndex('blueprints_project_kind_version_unique')
    .on(table.projectId, table.kind, table.version),
}));

export const blueprintCells = sqliteTable('blueprint_cells', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  blueprintId: integer('blueprint_id').notNull().references(() => blueprints.id, { onDelete: 'cascade' }),
  knowledgePointId: integer('knowledge_point_id').notNull().references(() => knowledgePoints.id),
  questionType: text('question_type').notNull(),
  cognitiveLevel: text('cognitive_level').notNull(),
  difficultyLevel: text('difficulty_level').notNull(),
  questionCount: integer('question_count').notNull().default(0),
  score: real('score').notNull().default(0),
  scoreRatio: real('score_ratio').notNull().default(0),
  tolerance: real('tolerance'),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  dimensionUnique: uniqueIndex('blueprint_cells_dimension_unique').on(
    table.blueprintId, table.knowledgePointId, table.questionType, table.cognitiveLevel, table.difficultyLevel,
  ),
}));

export const generationPlans = sqliteTable('generation_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  courseId: integer('course_id').notNull().references(() => courses.id),
  examTemplateId: integer('exam_template_id').notNull().references(() => examTemplates.id),
  targetBlueprintId: integer('target_blueprint_id').notNull().references(() => blueprints.id),
  numberOfSets: integer('number_of_sets').notNull().default(1),
  totalScorePerSet: real('total_score_per_set').notNull(),
  isTeacherConfirmed: integer('is_teacher_confirmed', { mode: 'boolean' }).notNull().default(false),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const generationPlanItems = sqliteTable('generation_plan_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationPlanId: integer('generation_plan_id').notNull().references(() => generationPlans.id, { onDelete: 'cascade' }),
  slotKey: text('slot_key').notNull(),
  setNo: integer('set_no').notNull(),
  sectionId: text('section_id').notNull(),
  orderNo: integer('order_no').notNull(),
  knowledgePointIds: text('knowledge_point_ids').notNull(),
  questionType: text('question_type').notNull(),
  score: real('score').notNull(),
  difficulty: text('difficulty').notNull(),
  cognitiveLevel: text('cognitive_level').notNull(),
  expectedAnswerKind: text('expected_answer_kind').notNull(),
  contentRequirements: text('content_requirements').notNull().default('{}'),
  correspondingSlotKey: text('corresponding_slot_key'),
  sourceMaterialDocumentIds: text('source_material_document_ids').notNull().default('[]'),
  forbiddenSourceQuestionIds: text('forbidden_source_question_ids').notNull().default('[]'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  planSlotUnique: uniqueIndex('generation_plan_items_slot_unique').on(table.generationPlanId, table.setNo, table.slotKey),
}));

export const generatedQuestions = sqliteTable('generated_questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationPlanId: integer('generation_plan_id').references(() => generationPlans.id, { onDelete: 'set null' }),
  generationPlanItemId: integer('generation_plan_item_id').references(() => generationPlanItems.id, { onDelete: 'set null' }),
  similarQuestionJobId: integer('similar_question_job_id').references(() => similarQuestionJobs.id, { onDelete: 'set null' }),
  legacyQuestionId: integer('legacy_question_id').references(() => questions.id, { onDelete: 'set null' }),
  setNo: integer('set_no').notNull().default(1),
  questionType: text('question_type').notNull(),
  stem: text('stem').notNull().default('[]'),
  options: text('options'),
  subquestions: text('subquestions').notNull().default('[]'),
  score: real('score').notNull().default(0),
  answer: text('answer'),
  explanation: text('explanation').notNull().default('[]'),
  knowledgePointIds: text('knowledge_point_ids').notNull().default('[]'),
  cognitiveLevel: text('cognitive_level'),
  difficulty: text('difficulty'),
  sourceQuestionIds: text('source_question_ids').notNull().default('[]'),
  provider: text('provider').notNull().default('unknown-legacy'),
  model: text('model').notNull().default('unknown-legacy'),
  promptVersionId: integer('prompt_version_id').notNull().references(() => promptVersions.id),
  generationParameters: text('generation_parameters').notNull().default('{}'),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  legacyQuestionUnique: uniqueIndex('generated_questions_legacy_unique').on(table.legacyQuestionId),
  planItemIdx: index('generated_questions_plan_item_idx').on(table.generationPlanItemId),
}));

export const questionClassifications = sqliteTable('question_classifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionKind: text('question_kind', { enum: ['source', 'generated'] }).notNull(),
  sourceQuestionId: integer('source_question_id').references(() => sourceQuestions.id, { onDelete: 'cascade' }),
  generatedQuestionId: integer('generated_question_id').references(() => generatedQuestions.id, { onDelete: 'cascade' }),
  knowledgePointId: integer('knowledge_point_id').notNull().references(() => knowledgePoints.id),
  role: text('role', { enum: ['primary', 'secondary'] }).notNull(),
  cognitiveLevel: text('cognitive_level').notNull(),
  difficultyLevel: text('difficulty_level').notNull(),
  difficultyScore: real('difficulty_score').notNull(),
  difficultySource: text('difficulty_source').notNull(),
  difficultyReason: text('difficulty_reason').notNull(),
  confidence: real('confidence').notNull(),
  empiricalSampleSize: integer('empirical_sample_size'),
  isTeacherConfirmed: integer('is_teacher_confirmed', { mode: 'boolean' }).notNull().default(false),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  sourceKpUnique: uniqueIndex('question_classifications_source_kp_unique')
    .on(table.sourceQuestionId, table.knowledgePointId),
  generatedKpUnique: uniqueIndex('question_classifications_generated_kp_unique')
    .on(table.generatedQuestionId, table.knowledgePointId),
}));

export const rubrics = sqliteTable('rubrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedQuestionId: integer('generated_question_id').notNull().references(() => generatedQuestions.id, { onDelete: 'cascade' }),
  totalScore: real('total_score').notNull(),
  items: text('items').notNull(),
  generalRule: text('general_rule'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersionId: integer('prompt_version_id').notNull().references(() => promptVersions.id),
  generationParameters: text('generation_parameters').notNull().default('{}'),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  questionUnique: uniqueIndex('rubrics_generated_question_unique').on(table.generatedQuestionId),
}));

export const generatedPapers = sqliteTable('generated_papers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationPlanId: integer('generation_plan_id').references(() => generationPlans.id, { onDelete: 'set null' }),
  generationJobId: integer('generation_job_id').references(() => generationJobs.id, { onDelete: 'set null' }),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  legacyProjectFileId: integer('legacy_project_file_id').references(() => projectFiles.id, { onDelete: 'set null' }),
  setNo: integer('set_no').notNull().default(1),
  version: integer('version').notNull().default(1),
  title: text('title').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(120),
  totalScore: real('total_score').notNull().default(0),
  instructions: text('instructions').notNull().default('[]'),
  canonicalJson: text('canonical_json').notNull().default('{}'),
  actualBlueprintId: integer('actual_blueprint_id').references(() => blueprints.id, { onDelete: 'set null' }),
  validationReportId: integer('validation_report_id'),
  selectedAt: text('selected_at'),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  legacyFileUnique: uniqueIndex('generated_papers_legacy_file_unique').on(table.legacyProjectFileId),
  planSetVersionUnique: uniqueIndex('generated_papers_plan_set_version_unique')
    .on(table.generationPlanId, table.setNo, table.version),
}));

export const generatedPaperItems = sqliteTable('generated_paper_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedPaperId: integer('generated_paper_id').notNull().references(() => generatedPapers.id, { onDelete: 'cascade' }),
  generatedQuestionId: integer('generated_question_id').notNull().references(() => generatedQuestions.id),
  sectionId: text('section_id').notNull(),
  sectionTitle: text('section_title').notNull(),
  orderNo: integer('order_no').notNull(),
  score: real('score').notNull(),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  paperOrderUnique: uniqueIndex('generated_paper_items_order_unique').on(table.generatedPaperId, table.orderNo),
}));

export const validationReports = sqliteTable('validation_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedPaperId: integer('generated_paper_id').notNull().references(() => generatedPapers.id, { onDelete: 'cascade' }),
  targetBlueprintId: integer('target_blueprint_id').references(() => blueprints.id, { onDelete: 'set null' }),
  actualBlueprintId: integer('actual_blueprint_id').references(() => blueprints.id, { onDelete: 'set null' }),
  passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
  findings: text('findings').notNull().default('[]'),
  metrics: text('metrics').notNull().default('{}'),
  validatorVersion: text('validator_version').notNull(),
  aiRunId: integer('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  paperIdx: index('validation_reports_paper_idx').on(table.generatedPaperId),
}));

export const exportArtifacts = sqliteTable('export_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedPaperId: integer('generated_paper_id').notNull().references(() => generatedPapers.id, { onDelete: 'cascade' }),
  paperVersion: integer('paper_version').notNull(),
  artifactType: text('artifact_type', { enum: ['question_paper', 'answer_key', 'rubric', 'combined_teacher_package'] }).notNull(),
  audience: text('audience', { enum: ['student', 'teacher', 'grader', 'internal'] }).notNull(),
  format: text('format', { enum: ['markdown', 'latex', 'pdf', 'docx'] }).notNull(),
  storagePath: text('storage_path').notNull(),
  sha256: text('sha256').notNull(),
  contentHash: text('content_hash').notNull(),
  rendererVersion: text('renderer_version').notNull(),
  sourcePaperHash: text('source_paper_hash').notNull(),
  integrity: text('integrity').notNull().default('{}'),
  generationStatus: text('generation_status').notNull().default('pending'),
  validationStatus: text('validation_status').notNull().default('pending'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  renditionUnique: uniqueIndex('export_artifacts_rendition_unique')
    .on(table.generatedPaperId, table.paperVersion, table.artifactType, table.audience, table.format, table.rendererVersion),
}));

export const questions = sqliteTable('questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdBy: integer('created_by').notNull().references(() => users.id),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  sourceFileId: integer('source_file_id').references(() => projectFiles.id, { onDelete: 'set null' }),
  sourceProjectId: integer('source_project_id').references(() => projects.id, { onDelete: 'set null' }),
  sourceQuestionNo: text('source_question_no'),
  type: text('type', {
    enum: ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'calculation', 'essay'],
  }).notNull(),
  stem: text('stem').notNull(),
  options: text('options'),
  answerKey: text('answer_key'),
  analysis: text('analysis'),
  scoringRubric: text('scoring_rubric'),
  defaultScore: real('default_score').notNull().default(0),
  difficulty: text('difficulty', { enum: ['basic', 'medium', 'hard'] }),
  predictedDifficultyScore: real('predicted_difficulty_score'),
  teacherDifficultyScore: real('teacher_difficulty_score'),
  knowledgePoints: text('knowledge_points'),
  status: text('status', { enum: ['generated', 'reviewed', 'rejected'] }).notNull().default('generated'),
  aiGenerated: integer('ai_generated', { mode: 'boolean' }).notNull().default(false),
  origin: text('origin', { enum: ['past_exam', 'ai_generated', 'teacher_created', 'imported'] }).notNull().default('teacher_created'),
  lifecycleStatus: text('lifecycle_status', { enum: ['draft', 'reviewed', 'approved', 'needs_review', 'archived'] }).notNull().default('draft'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  ownerStatusIdx: index('questions_owner_status_idx').on(table.createdBy, table.status),
  sourceIdx: index('questions_source_file_idx').on(table.sourceFileId),
  sourceQuestionUnique: uniqueIndex('questions_source_question_unique')
    .on(table.sourceFileId, table.sourceQuestionNo),
}));

export const questionVersions = sqliteTable('question_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionId: integer('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  versionNo: integer('version_no').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  changedBy: integer('changed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  changeNote: text('change_note'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  questionVersionUnique: uniqueIndex('question_versions_question_version_unique').on(table.questionId, table.versionNo),
  questionIdx: index('question_versions_question_idx').on(table.questionId, table.versionNo),
}));

export const papers = sqliteTable('papers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdBy: integer('created_by').notNull().references(() => users.id),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  sourceProjectId: integer('source_project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  course: text('course').notNull(),
  description: text('description'),
  instructions: text('instructions'),
  durationMinutes: integer('duration_minutes').notNull().default(120),
  totalScore: real('total_score').notNull().default(0),
  status: text('status', { enum: ['draft', 'ready', 'archived'] }).notNull().default('draft'),
  creationMethod: text('creation_method', { enum: ['ai_generated', 'manual', 'imported'] }).notNull().default('manual'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  ownerStatusIdx: index('papers_owner_status_idx').on(table.createdBy, table.status),
}));

export const paperQuestions = sqliteTable('paper_questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: integer('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  questionId: integer('question_id').notNull().references(() => questions.id),
  sectionTitle: text('section_title'),
  orderNo: integer('order_no').notNull(),
  score: real('score').notNull(),
  questionSnapshot: text('question_snapshot'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  paperOrderUnique: uniqueIndex('paper_questions_paper_order_unique').on(table.paperId, table.orderNo),
  paperIdx: index('paper_questions_paper_idx').on(table.paperId),
}));

export const exams = sqliteTable('exams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  paperId: integer('paper_id').notNull().references(() => papers.id),
  createdBy: integer('created_by').notNull().references(() => users.id),
  title: text('title').notNull(),
  status: text('status', { enum: ['draft', 'published', 'closed'] }).notNull().default('draft'),
  startAt: text('start_at'),
  endAt: text('end_at'),
  durationMinutes: integer('duration_minutes').notNull().default(120),
  allowedAttempts: integer('allowed_attempts').notNull().default(1),
  fillBlankIgnoreCase: integer('fill_blank_ignore_case', { mode: 'boolean' }).notNull().default(false),
  showAnswers: integer('show_answers', { mode: 'boolean' }).notNull().default(false),
  showAnalysis: integer('show_analysis', { mode: 'boolean' }).notNull().default(false),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  ownerStatusIdx: index('exams_owner_status_idx').on(table.createdBy, table.status),
}));

export const examAssignments = sqliteTable('exam_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  examId: integer('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => users.id),
  assignedAt: text('assigned_at').notNull().default(sql`(datetime('now'))`),
  dueAt: text('due_at'),
}, (table) => ({
  examStudentUnique: uniqueIndex('exam_assignments_exam_student_unique').on(table.examId, table.studentId),
  studentIdx: index('exam_assignments_student_idx').on(table.studentId),
}));

export const attempts = sqliteTable('attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  examId: integer('exam_id').notNull().references(() => exams.id),
  assignmentId: integer('assignment_id').notNull().references(() => examAssignments.id),
  studentId: integer('student_id').notNull().references(() => users.id),
  attemptNo: integer('attempt_no').notNull().default(1),
  status: text('status', {
    enum: ['not_started', 'in_progress', 'submitted', 'grading', 'graded'],
  }).notNull().default('not_started'),
  paperSnapshot: text('paper_snapshot'),
  startedAt: text('started_at'),
  expiresAt: text('expires_at'),
  submittedAt: text('submitted_at'),
  objectiveScore: real('objective_score').notNull().default(0),
  subjectiveScore: real('subjective_score').notNull().default(0),
  totalScore: real('total_score').notNull().default(0),
  gradedBy: integer('graded_by').references(() => users.id),
  gradedAt: text('graded_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  examStudentAttemptUnique: uniqueIndex('attempts_exam_student_attempt_unique')
    .on(table.examId, table.studentId, table.attemptNo),
  assignmentIdx: index('attempts_assignment_idx').on(table.assignmentId),
}));

export const answers = sqliteTable('answers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attemptId: integer('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  paperQuestionId: integer('paper_question_id').notNull().references(() => paperQuestions.id),
  content: text('content'),
  autoScore: real('auto_score'),
  manualScore: real('manual_score'),
  finalScore: real('final_score'),
  isCorrect: integer('is_correct', { mode: 'boolean' }),
  gradingStatus: text('grading_status', {
    enum: ['ungraded', 'auto_graded', 'manual_graded'],
  }).notNull().default('ungraded'),
  feedback: text('feedback'),
  gradedBy: integer('graded_by').references(() => users.id),
  gradedAt: text('graded_at'),
  savedAt: text('saved_at').notNull().default(sql`(datetime('now'))`),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  attemptQuestionUnique: uniqueIndex('answers_attempt_question_unique')
    .on(table.attemptId, table.paperQuestionId),
  attemptIdx: index('answers_attempt_idx').on(table.attemptId),
}));

export const questionQualityReports = sqliteTable('question_quality_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  examId: integer('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  paperQuestionId: integer('paper_question_id').notNull().references(() => paperQuestions.id, { onDelete: 'cascade' }),
  questionId: integer('question_id').notNull().references(() => questions.id, { onDelete: 'restrict' }),
  sampleSize: integer('sample_size').notNull(),
  correctRate: real('correct_rate'),
  empiricalDifficulty: real('empirical_difficulty'),
  discriminationIndex: real('discrimination_index'),
  pointBiserial: real('point_biserial'),
  optionStatistics: text('option_statistics').notNull().default('[]'),
  blankRate: real('blank_rate').notNull().default(0),
  averageScoreRate: real('average_score_rate'),
  qualityFlags: text('quality_flags').notNull().default('[]'),
  metricStatus: text('metric_status').notNull(),
  reviewStatus: text('review_status', { enum: ['pending', 'confirmed', 'ignored', 'needs_revision'] }).notNull().default('pending'),
  reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: text('reviewed_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  examQuestionUnique: uniqueIndex('question_quality_reports_exam_question_unique').on(table.examId, table.paperQuestionId),
  examStatusIdx: index('question_quality_reports_exam_status_idx').on(table.examId, table.reviewStatus),
}));

export const difficultyCalibrationRecords = sqliteTable('difficulty_calibration_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  questionId: integer('question_id').notNull().references(() => questions.id, { onDelete: 'restrict' }),
  questionQualityReportId: integer('question_quality_report_id').notNull().references(() => questionQualityReports.id, { onDelete: 'cascade' }),
  predictedDifficulty: real('predicted_difficulty'),
  teacherDifficulty: real('teacher_difficulty'),
  empiricalDifficulty: real('empirical_difficulty').notNull(),
  sampleSize: integer('sample_size').notNull(),
  predictionError: real('prediction_error'),
  calibrationLabel: text('calibration_label', { enum: ['ai_underestimated', 'ai_overestimated', 'aligned', 'unavailable'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  reportUnique: uniqueIndex('difficulty_calibration_records_report_unique').on(table.questionQualityReportId),
  courseIdx: index('difficulty_calibration_records_course_idx').on(table.courseId, table.createdAt),
  questionIdx: index('difficulty_calibration_records_question_idx').on(table.questionId, table.createdAt),
}));

export const courseDifficultyCalibrations = sqliteTable('course_difficulty_calibrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  sampleSize: integer('sample_size').notNull().default(0),
  mae: real('mae'),
  rmse: real('rmse'),
  bias: real('bias'),
  status: text('status', { enum: ['available', 'insufficient_sample'] }).notNull().default('insufficient_sample'),
  computedAt: text('computed_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  courseUnique: uniqueIndex('course_difficulty_calibrations_course_unique').on(table.courseId),
}));
