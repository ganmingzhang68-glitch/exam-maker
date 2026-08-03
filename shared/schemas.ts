import { z } from 'zod';

// ============ Auth ============
export const loginSchema = z.object({
  username: z.string().min(2, '用户名至少2个字符'),
  password: z.string().min(6, '密码至少6个字符'),
});

export const registerSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email('请输入有效的邮箱'),
  password: z.string().min(6, '密码至少6个字符'),
});

// ============ Project ============
export const difficultyRatioSchema = z.object({
  basic: z.number().min(0).max(100),
  medium: z.number().min(0).max(100),
  hard: z.number().min(0).max(100),
}).refine(d => d.basic + d.medium + d.hard === 100, '难度比例之和必须为100%');

export const createProjectSchema = z.object({
  title: z.string().min(1, '项目名称不能为空'),
  course: z.string().min(1, '课程名不能为空'),
  scope: z.string().optional(),
  difficulty: difficultyRatioSchema.default({ basic: 60, medium: 30, hard: 10 }),
  nSets: z.number().int().min(1).max(50).default(8),
  outputType: z.enum(['latex', 'docx', 'md']).default('latex'),
  verifyMode: z.enum(['auto', 'computational', 'conceptual', 'mixed']).default('auto'),
});

// ============ Checkpoint ============
export const checkpointActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
});

// ============ Exam MVP foundation ============
export const questionTypeSchema = z.enum([
  'single_choice', 'multiple_choice', 'true_false', 'fill_blank',
  'short_answer', 'calculation', 'essay',
]);
export const questionStatusSchema = z.enum(['generated', 'reviewed', 'rejected']);
export const difficultyLevelSchema = z.enum(['basic', 'medium', 'hard']);

const questionFieldsSchema = z.object({
  type: questionTypeSchema,
  stem: z.string().trim().min(1, '题干不能为空').max(50000),
  options: z.array(z.string().max(10000)).max(20).nullable().optional(),
  answerKey: z.record(z.unknown()).nullable().optional(),
  analysis: z.string().max(50000).nullable().optional(),
  scoringRubric: z.record(z.unknown()).nullable().optional(),
  defaultScore: z.number().min(0).max(1000).default(0),
  difficulty: difficultyLevelSchema.nullable().optional(),
  knowledgePoints: z.array(z.string().trim().min(1).max(100)).max(50).nullable().optional(),
  status: questionStatusSchema.default('generated'),
  sourceFileId: z.number().int().positive().nullable().optional(),
  sourceProjectId: z.number().int().positive().nullable().optional(),
  sourceQuestionNo: z.string().trim().max(100).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export const createQuestionSchema = questionFieldsSchema.superRefine((value, ctx) => {
  if ((value.type === 'single_choice' || value.type === 'multiple_choice') &&
      (!value.options || value.options.length < 2)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '选择题至少需要两个选项' });
  }
});

export const updateQuestionSchema = questionFieldsSchema.partial().superRefine((value, ctx) => {
  if (value.stem !== undefined && value.stem.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stem'], message: '题干不能为空' });
  }
});

export const questionListQuerySchema = z.object({
  status: questionStatusSchema.optional(),
  type: questionTypeSchema.optional(),
  difficulty: difficultyLevelSchema.optional(),
  sourceFileId: z.coerce.number().int().positive().optional(),
  sourceProjectId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const positiveIdSchema = z.coerce.number().int().positive();

export const reviewQuestionSchema = z.object({
  status: z.enum(['reviewed', 'rejected']),
});

export const paperStatusSchema = z.enum(['draft', 'ready', 'archived']);

export const createPaperSchema = z.object({
  title: z.string().trim().min(1, '试卷标题不能为空').max(200),
  course: z.string().trim().min(1, '课程名称不能为空').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  instructions: z.string().trim().max(10000).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440).default(120),
  status: paperStatusSchema.default('draft'),
  sourceProjectId: z.number().int().positive().nullable().optional(),
});

export const updatePaperSchema = createPaperSchema.partial();

export const paperListQuerySchema = z.object({
  status: paperStatusSchema.optional(),
});

export const addPaperQuestionSchema = z.object({
  questionId: z.number().int().positive(),
  score: z.number().min(0).max(1000).optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
});

export const updatePaperQuestionSchema = z.object({
  score: z.number().min(0).max(1000).optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');

export const reorderPaperQuestionsSchema = z.object({
  paperQuestionIds: z.array(z.number().int().positive()).max(1000),
}).superRefine((value, ctx) => {
  if (new Set(value.paperQuestionIds).size !== value.paperQuestionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paperQuestionIds'], message: '题目顺序中不能包含重复项' });
  }
});

export const examStatusSchema = z.enum(['draft', 'published', 'closed']);

export const createExamSchema = z.object({
  paperId: z.number().int().positive(),
  title: z.string().trim().min(1, '考试名称不能为空').max(200),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(1).max(1440),
  allowedAttempts: z.number().int().min(1).max(20).default(1),
}).superRefine((value, ctx) => {
  if (new Date(value.startAt).getTime() >= new Date(value.endAt).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: '结束时间必须晚于开始时间' });
  }
});

export const updateExamSchema = z.object({
  paperId: z.number().int().positive().optional(),
  title: z.string().trim().min(1, '考试名称不能为空').max(200).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  allowedAttempts: z.number().int().min(1).max(20).optional(),
});

export const answerContentSchema = z.union([
  z.string().max(100000),
  z.array(z.string().max(10000)).max(100),
  z.record(z.unknown()),
]).nullable();

export const saveAnswerSchema = z.object({
  content: answerContentSchema,
});
