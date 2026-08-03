import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['teacher', 'student', 'admin'] }).notNull().default('student'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

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

export const questions = sqliteTable('questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdBy: integer('created_by').notNull().references(() => users.id),
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
  knowledgePoints: text('knowledge_points'),
  status: text('status', { enum: ['generated', 'reviewed', 'rejected'] }).notNull().default('generated'),
  aiGenerated: integer('ai_generated', { mode: 'boolean' }).notNull().default(false),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  ownerStatusIdx: index('questions_owner_status_idx').on(table.createdBy, table.status),
  sourceIdx: index('questions_source_file_idx').on(table.sourceFileId),
  sourceQuestionUnique: uniqueIndex('questions_source_question_unique')
    .on(table.sourceFileId, table.sourceQuestionNo),
}));

export const papers = sqliteTable('papers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdBy: integer('created_by').notNull().references(() => users.id),
  sourceProjectId: integer('source_project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  course: text('course').notNull(),
  description: text('description'),
  instructions: text('instructions'),
  durationMinutes: integer('duration_minutes').notNull().default(120),
  totalScore: real('total_score').notNull().default(0),
  status: text('status', { enum: ['draft', 'ready', 'archived'] }).notNull().default('draft'),
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
