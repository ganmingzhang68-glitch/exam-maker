import { z } from 'zod';
import { promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const rubricGenerationInputSchema = z.object({
  question: z.object({
    id: z.string().min(1), questionType: z.string().min(1), stem: z.array(z.record(z.unknown())).min(1),
    subquestions: z.array(z.object({ id: z.string().min(1), label: z.string().nullable(), stem: z.array(z.record(z.unknown())).min(1), score: z.number().nonnegative() }).strict()),
    score: z.number().positive(),
  }).strict(),
  answer: z.object({ answer: z.record(z.unknown()), explanation: z.array(z.string()), keySteps: z.array(z.string()), acceptableAlternatives: z.array(z.string()) }).strict(),
}).strict();

export const rubricGenerationOutputSchema = z.object({
  status: promptStatusSchema, questionId: z.string().min(1), totalScore: z.number().positive(),
  items: z.array(z.object({ id: z.string().min(1), description: z.string().min(1), points: z.number().positive(), acceptableExpressions: z.array(z.string()), equivalentSolutions: z.array(z.string()), commonErrors: z.array(z.object({ error: z.string().min(1), deduction: z.number().nonnegative() }).strict()), partialCreditRule: z.string().nullable() }).strict()),
  generalRule: z.string().nullable(), issues: z.array(promptIssueSchema),
}).strict().superRefine((value, ctx) => {
  const sum = value.items.reduce((total, item) => total + item.points, 0);
  if (value.status === 'ok' && Math.abs(sum - value.totalScore) > 1e-6) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'rubric 分项之和必须等于题目总分' });
  }
});

export const rubricGenerationPrompt: PromptDefinition<typeof rubricGenerationInputSchema, typeof rubricGenerationOutputSchema> = {
  id: 'rubric_generation_prompt', version: '1.0.1', stage: 'answer_and_rubric_generation',
  task: '只依据冻结题面（包括全部小问）、已生成答案和题目总分生成逐项评分标准。不得修改题面或答案；每个小问必须有对应评分项；status=ok 时评分项分值之和必须等于 totalScore。',
  inputSchema: rubricGenerationInputSchema, outputSchema: rubricGenerationOutputSchema,
  outputContract: { status: 'ok|uncertain', questionId: 'string', totalScore: 'number', items: 'RubricItem[]', generalRule: 'string|null', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { questionId: input.question.id, questionType: input.question.questionType, totalScore: input.question.score }, untrustedData: { frozenQuestion: input.question, generatedAnswer: input.answer } }),
  examples: {
    correct: { status: 'ok', questionId: 'gq-1', totalScore: 10, items: [{ id: 'r1', description: '写出关键关系', points: 4, acceptableExpressions: ['等价符号表达'], equivalentSolutions: [], commonErrors: [{ error: '关系方向错误', deduction: 2 }], partialCreditRule: '关系正确但符号不规范可得3分' }, { id: 'r2', description: '推导并给出结论', points: 6, acceptableExpressions: ['逻辑等价结论'], equivalentSolutions: ['反证法'], commonErrors: [], partialCreditRule: '推导正确但结论漏写扣1分' }], generalRule: '同一错误不重复扣分', issues: [] },
    exceptional: { status: 'uncertain', questionId: 'gq-1', totalScore: 10, items: [], generalRule: null, issues: [{ code: 'ANSWER_NOT_VERIFIED', message: '答案未验证，不能建立可靠评分标准', evidence: ['question:gq-1'] }] },
  },
};
