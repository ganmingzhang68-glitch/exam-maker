import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

const answerValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single_choice'), optionId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('multiple_choice'), optionIds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('text'), accepted: z.array(z.string().min(1)).min(1), caseSensitive: z.boolean() }).strict(),
  z.object({ kind: z.literal('numeric'), value: z.string().min(1), tolerance: z.string().nullable(), unit: z.string().nullable() }).strict(),
  z.object({ kind: z.literal('expression'), latex: z.string().min(1), equivalentForms: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('subjective'), keyPoints: z.array(z.string().min(1)).min(1) }).strict(),
]);

export const answerGenerationInputSchema = z.object({
  question: z.object({ id: z.string().min(1), questionType: z.string().min(1), stem: z.array(z.record(z.unknown())).min(1), options: z.array(z.object({ id: z.string(), content: z.array(z.record(z.unknown())) }).strict()), subquestions: z.array(z.record(z.unknown())), score: z.number().positive() }).strict(),
  expectedAnswerKind: z.string().min(1), referenceMaterials: z.array(z.object({ sourceDocumentId: z.number().int().positive(), excerpt: z.string(), evidence: z.array(evidenceSchema) }).strict()),
}).strict();

export const answerGenerationOutputSchema = z.object({
  status: promptStatusSchema, questionId: z.string().min(1), answer: answerValueSchema.nullable(),
  explanation: z.array(z.string()), keySteps: z.array(z.string()), acceptableAlternatives: z.array(z.string()),
  distractorAnalysis: z.array(z.object({ optionId: z.string().min(1), analysis: z.string().min(1) }).strict()),
  confidence: z.number().min(0).max(1), evidence: z.array(evidenceSchema), issues: z.array(promptIssueSchema),
}).strict();

export const answerGenerationPrompt: PromptDefinition<typeof answerGenerationInputSchema, typeof answerGenerationOutputSchema> = {
  id: 'answer_generation_prompt', version: '1.0.0', stage: 'answer_and_rubric_generation',
  task: '只针对冻结题面生成参考答案、解释、关键步骤、等价答案和客观题干扰项分析。不得修改题面，不得分配评分分值或输出 rubric。',
  inputSchema: answerGenerationInputSchema, outputSchema: answerGenerationOutputSchema,
  outputContract: { status: 'ok|uncertain', questionId: 'string', answer: 'AnswerSpec|null', explanation: 'string[]', keySteps: 'string[]', acceptableAlternatives: 'string[]', distractorAnalysis: 'DistractorAnalysis[]', confidence: '0..1', evidence: 'Evidence[]', issues: 'Issue[]', additionalProperties: false, forbiddenFields: ['rubric', 'scoreChanges'] },
  splitInput: input => ({ trustedContext: { questionId: input.question.id, expectedAnswerKind: input.expectedAnswerKind, frozenScore: input.question.score }, untrustedData: { question: input.question, referenceMaterials: input.referenceMaterials } }),
  examples: {
    correct: { status: 'ok', questionId: 'gq-1', answer: { kind: 'single_choice', optionId: 'B' }, explanation: ['由题设条件可排除 A、C、D。'], keySteps: ['读取条件', '逐项判断'], acceptableAlternatives: [], distractorAnalysis: [{ optionId: 'A', analysis: '忽略了限制条件' }, { optionId: 'C', analysis: '混淆相近概念' }, { optionId: 'D', analysis: '结论方向相反' }], confidence: 0.92, evidence: [], issues: [] },
    exceptional: { status: 'uncertain', questionId: 'gq-1', answer: null, explanation: [], keySteps: [], acceptableAlternatives: [], distractorAnalysis: [], confidence: 0.05, evidence: [], issues: [{ code: 'QUESTION_CONTRADICTION', message: '题面条件互相矛盾，不能可靠求解', evidence: ['question:gq-1'] }] },
  },
};
