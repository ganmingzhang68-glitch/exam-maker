import { z } from 'zod';

export const domainEntityStatusSchema = z.enum([
  'draft', 'pending', 'processing', 'needs_review', 'approved', 'rejected',
  'succeeded', 'failed', 'locked', 'ready', 'teacher_review', 'archived', 'legacy',
]);

export const generationStageSchema = z.enum([
  'document_extraction',
  'exam_structure_parsing',
  'question_answer_alignment',
  'question_normalization',
  'knowledge_taxonomy_building',
  'question_classification',
  'exam_template_extraction',
  'historical_blueprint_generation',
  'target_blueprint_creation',
  'paper_generation_planning',
  'question_generation',
  'answer_and_rubric_generation',
  'paper_validation',
  'paper_export',
]);

export const stageRunStatusSchema = z.enum([
  'pending', 'running', 'needs_review', 'succeeded', 'failed', 'cancelled',
]);

export const entityIdentitySchema = z.object({
  id: z.number().int().positive(),
  status: domainEntityStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), markdown: z.string() }),
  z.object({ type: z.literal('math'), latex: z.string().min(1), display: z.boolean().default(false) }),
  z.object({
    type: z.literal('table'),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal('image'),
    assetId: z.number().int().positive(),
    alt: z.string(),
    caption: z.string().optional(),
  }),
  z.object({ type: z.literal('code'), language: z.string().optional(), code: z.string() }),
  z.object({ type: z.literal('material'), title: z.string().optional(), blocks: z.array(z.unknown()) }),
  z.object({ type: z.literal('page_break') }),
]);

export const questionTypeV2Schema = z.enum([
  'single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer',
  'calculation', 'proof', 'essay', 'material', 'code', 'composite',
]);

export const optionSchema = z.object({
  id: z.string().trim().min(1).max(20),
  content: z.array(contentBlockSchema).min(1),
});

export const answerKindSchema = z.enum([
  'single_choice', 'multiple_choice', 'boolean', 'text', 'numeric', 'expression', 'subjective',
]);

export const answerSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single_choice'), optionId: z.string().min(1) }),
  z.object({ kind: z.literal('multiple_choice'), optionIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({
    kind: z.literal('text'), accepted: z.array(z.string()).min(1),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('numeric'), value: z.string().min(1),
    tolerance: z.string().optional(), unit: z.string().optional(),
  }),
  z.object({
    kind: z.literal('expression'), latex: z.string().min(1),
    equivalentForms: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal('subjective'), keyPoints: z.array(z.string()).min(1) }),
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type AnswerSpec = z.infer<typeof answerSpecSchema>;

export interface QuestionPart {
  id: string;
  label?: string;
  stem: ContentBlock[];
  score: number;
  answer?: AnswerSpec | null;
  children: QuestionPart[];
}

export const questionPartSchema: z.ZodType<QuestionPart, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  stem: z.array(contentBlockSchema).min(1),
  score: z.number().min(0),
  answer: answerSpecSchema.nullable().optional(),
  children: z.array(questionPartSchema).default([]),
}));

export const difficultyAssessmentSchema = z.object({
  difficultyLevel: z.enum(['basic', 'medium', 'hard']),
  difficultyScore: z.number().min(0).max(1),
  difficultySource: z.enum(['predicted', 'teacher_adjusted', 'empirical']),
  difficultyReason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  empiricalSampleSize: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.difficultySource === 'empirical' && !value.empiricalSampleSize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['empiricalSampleSize'],
      message: '实测难度必须提供有效学生样本量',
    });
  }
});

export const sourceLocatorSchema = z.object({
  sourceDocumentId: z.number().int().positive(),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  originalQuestionNo: z.string().nullable(),
  boundingBoxes: z.array(z.object({
    page: z.number().int().positive(),
    x: z.number().min(0), y: z.number().min(0),
    width: z.number().positive(), height: z.number().positive(),
  })).default([]),
  excerptHash: z.string().min(1),
});

export const aiGenerationMetadataSchema = z.object({
  aiRunId: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersionId: z.number().int().positive(),
  parameters: z.record(z.unknown()),
});

export const courseSchema = entityIdentitySchema.extend({
  ownerUserId: z.number().int().positive(),
  code: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(1),
  semester: z.string().nullable(),
  description: z.string().nullable(),
  instructorName: z.string().nullable(),
  materialDocumentIds: z.array(z.number().int().positive()).default([]),
  archivedAt: z.string().nullable(),
});

export const sourceDocumentSchema = entityIdentitySchema.extend({
  projectId: z.number().int().positive(),
  courseId: z.number().int().positive(),
  projectFileId: z.number().int().positive().nullable(),
  documentKind: z.enum(['exam', 'answer', 'exam_with_answer', 'syllabus', 'material']),
  filename: z.string().min(1),
  storagePath: z.string().min(1),
  mimeType: z.string().nullable(),
  sha256: z.string().min(1),
  pageCount: z.number().int().nonnegative().nullable(),
  extractionConfidence: z.number().min(0).max(1).nullable(),
  metadata: z.record(z.unknown()).default({}),
});

export const sourceExamSchema = entityIdentitySchema.extend({
  courseId: z.number().int().positive(),
  sourceDocumentId: z.number().int().positive(),
  title: z.string().min(1),
  academicYear: z.string().nullable(),
  term: z.string().nullable(),
  paperVariant: z.string().nullable(),
  totalScore: z.number().min(0).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  instructions: z.array(contentBlockSchema).default([]),
  structure: z.record(z.unknown()).default({}),
});

export const sourceQuestionReviewStatusSchema = z.enum([
  'unreviewed', 'needs_alignment', 'confirmed', 'rejected',
]);

export const sourceQuestionSchema = entityIdentitySchema.extend({
  sourceExamId: z.number().int().positive(),
  sourceDocumentId: z.number().int().positive(),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  originalQuestionNo: z.string().min(1),
  rawStem: z.string().min(1),
  normalizedStem: z.array(contentBlockSchema).default([]),
  questionType: questionTypeV2Schema,
  options: z.array(optionSchema).nullable(),
  subquestions: z.array(questionPartSchema).default([]),
  originalScore: z.number().min(0).nullable(),
  rawAnswer: z.string().nullable(),
  rawAnalysis: z.string().nullable(),
  contentReferences: z.array(z.object({
    kind: z.enum(['image', 'formula', 'table', 'code', 'material']),
    assetId: z.number().int().positive().nullable(),
    source: z.string().min(1),
  })).default([]),
  extractionConfidence: z.number().min(0).max(1),
  teacherReviewStatus: sourceQuestionReviewStatusSchema,
  alignmentConfidence: z.number().min(0).max(1).nullable(),
});

export const knowledgePointSchema = entityIdentitySchema.extend({
  courseId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  aliases: z.array(z.string()).default([]),
  isLocked: z.boolean(),
  lockedBy: z.number().int().positive().nullable(),
  lockedAt: z.string().nullable(),
  mergedIntoId: z.number().int().positive().nullable(),
  sortOrder: z.number().int().nonnegative(),
});

export const cognitiveLevelSchema = z.enum([
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
]);

export const questionClassificationSchema = entityIdentitySchema.extend({
  questionKind: z.enum(['source', 'generated']),
  questionRefId: z.number().int().positive(),
  knowledgePointId: z.number().int().positive(),
  role: z.enum(['primary', 'secondary']),
  cognitiveLevel: cognitiveLevelSchema,
  difficulty: difficultyAssessmentSchema,
  confidence: z.number().min(0).max(1),
  isTeacherConfirmed: z.boolean(),
  aiMetadata: aiGenerationMetadataSchema.nullable(),
});

export const assessmentTemplateSchema = z.object({
  sections: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    questionType: questionTypeV2Schema,
    questionCount: z.number().int().positive(),
    scorePerQuestion: z.number().min(0),
    subtotal: z.number().min(0),
    order: z.number().int().nonnegative(),
    optionalRule: z.string().nullable(),
  })).min(1),
  totalScore: z.number().positive(),
  durationMinutes: z.number().int().positive(),
  instructions: z.array(contentBlockSchema).default([]),
  optionalRules: z.array(z.string()).default([]),
}).superRefine((value, ctx) => {
  const subtotal = value.sections.reduce((sum, section) => sum + section.subtotal, 0);
  if (Math.abs(subtotal - value.totalScore) > 1e-6) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['totalScore'], message: '各分区小计必须等于总分' });
  }
  value.sections.forEach((section, index) => {
    const expected = section.questionCount * section.scorePerQuestion;
    if (Math.abs(expected - section.subtotal) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', index, 'subtotal'], message: '题型分区小计不正确' });
    }
  });
});

export const renderingTemplateSchema = z.object({
  titlePattern: z.string().min(1),
  schoolName: z.string().nullable(),
  courseInfoFields: z.array(z.string()).default([]),
  header: z.string().nullable(),
  footer: z.string().nullable(),
  studentInfoFields: z.array(z.string()).default([]),
  sealedLine: z.boolean(),
  fontConfig: z.record(z.unknown()).default({}),
  layoutConfig: z.record(z.unknown()).default({}),
  answerPageStructure: z.record(z.unknown()).default({}),
  scoringColumns: z.array(z.string()).default([]),
});

export const examTemplateSchema = entityIdentitySchema.extend({
  courseId: z.number().int().positive(),
  name: z.string().min(1),
  version: z.number().int().positive(),
  assessmentTemplate: assessmentTemplateSchema,
  renderingTemplate: renderingTemplateSchema,
  sourceExamIds: z.array(z.number().int().positive()).default([]),
  isTeacherConfirmed: z.boolean(),
  aiMetadata: aiGenerationMetadataSchema.nullable(),
});

export const blueprintCellSchema = z.object({
  knowledgePointId: z.number().int().positive(),
  questionType: questionTypeV2Schema,
  cognitiveLevel: cognitiveLevelSchema,
  difficultyLevel: z.enum(['basic', 'medium', 'hard']),
  questionCount: z.number().int().nonnegative(),
  score: z.number().min(0),
  scoreRatio: z.number().min(0).max(1),
  tolerance: z.number().min(0).max(1).optional(),
});

const blueprintBaseSchema = entityIdentitySchema.extend({
  courseId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  version: z.number().int().positive(),
  totalScore: z.number().positive(),
  cells: z.array(blueprintCellSchema),
  aiMetadata: aiGenerationMetadataSchema.nullable(),
});

function validateBlueprintRatios(
  value: { cells: Array<z.infer<typeof blueprintCellSchema>> },
  ctx: z.RefinementCtx,
) {
  const total = value.cells.reduce((sum, cell) => sum + cell.scoreRatio, 0);
  if (value.cells.length > 0 && Math.abs(total - 1) > 0.01) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cells'], message: '细目表分值占比之和必须为1' });
  }
}

export const historicalBlueprintSchema = blueprintBaseSchema.extend({
  kind: z.literal('historical'),
  sourceExamIds: z.array(z.number().int().positive()).min(1),
}).superRefine(validateBlueprintRatios);

export const targetBlueprintSchema = blueprintBaseSchema.extend({
  kind: z.literal('target'),
  historicalBlueprintId: z.number().int().positive().nullable(),
  teacherNotes: z.string().nullable(),
  isTeacherConfirmed: z.boolean(),
}).superRefine(validateBlueprintRatios);

export const actualBlueprintSchema = blueprintBaseSchema.extend({
  kind: z.literal('actual'),
  generatedPaperId: z.number().int().positive(),
  targetBlueprintId: z.number().int().positive(),
  deviationReportId: z.number().int().positive().nullable(),
}).superRefine(validateBlueprintRatios);

export const generationPlanSlotSchema = z.object({
  id: z.string().min(1),
  setNo: z.number().int().positive(),
  sectionId: z.string().min(1),
  order: z.number().int().positive(),
  knowledgePointIds: z.array(z.number().int().positive()).min(1),
  questionType: questionTypeV2Schema,
  score: z.number().positive(),
  difficulty: difficultyAssessmentSchema,
  cognitiveLevel: cognitiveLevelSchema,
  expectedAnswerKind: answerKindSchema,
  contentRequirements: z.object({
    formula: z.boolean(), image: z.boolean(), code: z.boolean(), material: z.boolean(), table: z.boolean(),
  }),
  correspondingSlotKey: z.string().nullable(),
  sourceMaterialDocumentIds: z.array(z.number().int().positive()).default([]),
  forbiddenSourceQuestionIds: z.array(z.number().int().positive()).default([]),
});

export const generationPlanSchema = entityIdentitySchema.extend({
  projectId: z.number().int().positive(),
  courseId: z.number().int().positive(),
  examTemplateId: z.number().int().positive(),
  targetBlueprintId: z.number().int().positive(),
  numberOfSets: z.number().int().positive().max(50),
  totalScorePerSet: z.number().positive(),
  slots: z.array(generationPlanSlotSchema).min(1),
  isTeacherConfirmed: z.boolean(),
  aiMetadata: aiGenerationMetadataSchema.nullable(),
});

export const generatedQuestionSchema = entityIdentitySchema.extend({
  generationPlanId: z.number().int().positive(),
  planSlotId: z.string().min(1),
  setNo: z.number().int().positive(),
  questionType: questionTypeV2Schema,
  stem: z.array(contentBlockSchema).min(1),
  options: z.array(optionSchema).nullable(),
  subquestions: z.array(questionPartSchema).default([]),
  score: z.number().positive(),
  answer: answerSpecSchema.nullable(),
  explanation: z.array(contentBlockSchema).default([]),
  knowledgePointIds: z.array(z.number().int().positive()).min(1),
  cognitiveLevel: cognitiveLevelSchema,
  difficulty: difficultyAssessmentSchema,
  sourceQuestionIds: z.array(z.number().int().positive()).default([]),
  rubricId: z.number().int().positive().nullable(),
  aiMetadata: aiGenerationMetadataSchema,
}).superRefine((value, ctx) => {
  const optionIds = new Set((value.options ?? []).map((option) => option.id));
  if (optionIds.size !== (value.options?.length ?? 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '选项ID不能重复' });
  }
  if (value.questionType === 'single_choice') {
    if (!value.options || value.options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '单选题至少需要两个选项' });
    }
    if (value.answer?.kind === 'single_choice' && !optionIds.has(value.answer.optionId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: '标准答案必须存在于选项中' });
    }
  }
  if (value.questionType === 'multiple_choice') {
    if (!value.options || value.options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '多选题至少需要两个选项' });
    }
    if (value.answer?.kind === 'multiple_choice') {
      const uniqueAnswers = new Set(value.answer.optionIds);
      if (uniqueAnswers.size !== value.answer.optionIds.length ||
          value.answer.optionIds.some((id) => !optionIds.has(id))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: '多选题答案必须唯一且全部存在于选项中' });
      }
    }
  }
});

export const rubricItemSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  points: z.number().positive(),
  acceptableExpressions: z.array(z.string()).default([]),
  commonErrors: z.array(z.object({ error: z.string().min(1), deduction: z.number().min(0) })).default([]),
  partialCreditRule: z.string().nullable(),
  equivalentSolutions: z.array(z.string()).default([]),
});

export const rubricSchema = entityIdentitySchema.extend({
  generatedQuestionId: z.number().int().positive(),
  totalScore: z.number().positive(),
  items: z.array(rubricItemSchema).min(1),
  generalRule: z.string().nullable(),
  aiMetadata: aiGenerationMetadataSchema,
}).superRefine((value, ctx) => {
  const total = value.items.reduce((sum, item) => sum + item.points, 0);
  if (Math.abs(total - value.totalScore) > 1e-6) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: '评分项分值之和必须等于题目总分' });
  }
});

export const generatedPaperSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().positive(),
  questionIds: z.array(z.number().int().positive()),
  subtotal: z.number().min(0),
});

export const generatedPaperSchema = entityIdentitySchema.extend({
  generationPlanId: z.number().int().positive(),
  generationJobId: z.number().int().positive(),
  courseId: z.number().int().positive(),
  setNo: z.number().int().positive(),
  title: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  totalScore: z.number().positive(),
  instructions: z.array(contentBlockSchema).default([]),
  sections: z.array(generatedPaperSectionSchema).min(1),
  actualBlueprintId: z.number().int().positive().nullable(),
  validationReportId: z.number().int().positive().nullable(),
  selectedAt: z.string().nullable(),
  aiRunIds: z.array(z.number().int().positive()).default([]),
});

export const validationFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  message: z.string().min(1),
  entityType: z.string().nullable(),
  entityId: z.number().int().positive().nullable(),
  details: z.record(z.unknown()).default({}),
});

export const validationReportSchema = entityIdentitySchema.extend({
  generatedPaperId: z.number().int().positive(),
  targetBlueprintId: z.number().int().positive(),
  actualBlueprintId: z.number().int().positive(),
  passed: z.boolean(),
  findings: z.array(validationFindingSchema),
  metrics: z.record(z.number()),
  validatorVersion: z.string().min(1),
  aiMetadata: aiGenerationMetadataSchema.nullable(),
});

export const exportArtifactSchema = entityIdentitySchema.extend({
  generatedPaperId: z.number().int().positive(),
  paperVersion: z.number().int().positive(),
  artifactType: z.enum(['question_paper', 'answer_key', 'rubric', 'combined_teacher_package']),
  audience: z.enum(['student', 'teacher', 'grader', 'internal']),
  format: z.enum(['markdown', 'latex', 'pdf', 'docx']),
  storagePath: z.string().min(1),
  sha256: z.string().min(1),
  contentHash: z.string().min(1),
  rendererVersion: z.string().min(1),
  sourcePaperHash: z.string().min(1),
  integrity: z.object({
    questionCount: z.number().int().nonnegative(),
    answerCount: z.number().int().nonnegative(),
    totalScore: z.number().min(0),
    compiled: z.boolean().nullable(),
    opened: z.boolean().nullable(),
  }),
  generationStatus: z.string().min(1),
  validationStatus: z.string().min(1),
});

export const generationJobStageSchema = z.object({
  stage: generationStageSchema,
  attemptNo: z.number().int().positive(),
  status: stageRunStatusSchema,
  inputArtifactId: z.number().int().positive().nullable(),
  outputArtifactId: z.number().int().positive().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  errorStack: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const generationJobSchema = entityIdentitySchema.extend({
  projectId: z.number().int().positive(),
  courseId: z.number().int().positive(),
  requestedBy: z.number().int().positive(),
  pipelineVersion: z.string().min(1),
  currentStage: generationStageSchema.nullable(),
  stages: z.array(generationJobStageSchema),
  lastSuccessfulStage: generationStageSchema.nullable(),
  numberOfSets: z.number().int().positive().max(50),
  errorSummary: z.string().nullable(),
});

export const promptVersionSchema = entityIdentitySchema.extend({
  key: z.string().min(1),
  version: z.string().min(1),
  stage: generationStageSchema,
  template: z.string(),
  inputSchemaVersion: z.string().min(1),
  outputSchemaVersion: z.string().min(1),
  sha256: z.string().min(1),
  createdBy: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
});

export const aiRunSchema = entityIdentitySchema.extend({
  generationJobId: z.number().int().positive().nullable(),
  stage: generationStageSchema,
  promptVersionId: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  parameters: z.record(z.unknown()),
  inputArtifactId: z.number().int().positive().nullable(),
  outputArtifactId: z.number().int().positive().nullable(),
  requestId: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  errorMessage: z.string().nullable(),
});

export function stageResultSchema<T extends z.ZodTypeAny>(outputSchema: T) {
  return z.object({
    stage: generationStageSchema,
    status: stageRunStatusSchema,
    input: z.record(z.unknown()),
    output: outputSchema.nullable(),
    errors: z.array(z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean(),
      details: z.record(z.unknown()).default({}),
    })).default([]),
  }).superRefine((value, ctx) => {
    if (value.status === 'succeeded' && value.output === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['output'], message: '成功阶段必须包含结构化输出' });
    }
    if (value.status === 'failed' && value.errors.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['errors'], message: '失败阶段必须保存错误信息' });
    }
  });
}

export type DomainEntityStatus = z.infer<typeof domainEntityStatusSchema>;
export type GenerationStage = z.infer<typeof generationStageSchema>;
export type DifficultyAssessment = z.infer<typeof difficultyAssessmentSchema>;
export type Course = z.infer<typeof courseSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type SourceExam = z.infer<typeof sourceExamSchema>;
export type SourceQuestion = z.infer<typeof sourceQuestionSchema>;
export type KnowledgePoint = z.infer<typeof knowledgePointSchema>;
export type QuestionClassification = z.infer<typeof questionClassificationSchema>;
export type ExamTemplate = z.infer<typeof examTemplateSchema>;
export type HistoricalBlueprint = z.infer<typeof historicalBlueprintSchema>;
export type TargetBlueprint = z.infer<typeof targetBlueprintSchema>;
export type ActualBlueprint = z.infer<typeof actualBlueprintSchema>;
export type GenerationPlan = z.infer<typeof generationPlanSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GeneratedPaper = z.infer<typeof generatedPaperSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ExportArtifact = z.infer<typeof exportArtifactSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type PromptVersion = z.infer<typeof promptVersionSchema>;
export type AiRun = z.infer<typeof aiRunSchema>;
