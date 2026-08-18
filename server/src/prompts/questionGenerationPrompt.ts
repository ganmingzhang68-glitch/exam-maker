import { z } from 'zod';
import { difficultyPromptSchema, evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

const generatedContentBlockSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: unknown }).type === 'text') {
    return { assetId: null, ...(value as Record<string, unknown>), type: 'paragraph' };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { assetId: null, ...(value as Record<string, unknown>) };
  }
  return value;
}, z.object({ type: z.enum(['paragraph', 'math', 'table', 'image', 'code', 'material']), content: z.string().min(1), assetId: z.number().int().positive().nullable() }).strict());

export const questionGenerationInputSchema = z.object({
  course: z.object({ id: z.number().int().positive(), name: z.string().min(1), scope: z.string().nullable() }).strict(),
  slot: z.object({ id: z.string().min(1), setNo: z.number().int().positive(), knowledgePointIds: z.array(z.string()).min(1), questionType: z.string().min(1), score: z.number().positive(), difficultyLevel: z.enum(['basic', 'medium', 'hard']), cognitiveLevel: z.string().min(1), expectedAnswerKind: z.string().min(1), variationAxis: z.string().min(1).optional(), contentRequirements: z.record(z.boolean()) }).strict(),
  referenceMaterials: z.array(z.object({ sourceDocumentId: z.number().int().positive(), excerpt: z.string(), evidence: z.array(evidenceSchema) }).strict()),
  forbiddenQuestions: z.array(z.object({ questionId: z.string().min(1), normalizedStem: z.string().min(1) }).strict()),
}).strict();

export const questionGenerationOutputSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = value as Record<string, unknown>;
  const totalScore = typeof output.score === 'number' ? output.score : null;
  if (!Array.isArray(output.subquestions) || output.subquestions.length === 0 || totalScore === null) return value;

  const subquestions = output.subquestions.map(item =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? { label: null, ...(item as Record<string, unknown>) }
      : item);
  const missing = subquestions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).score !== 'number');
  const knownTotal = subquestions.reduce((sum, item) =>
    sum + (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).score === 'number'
      ? (item as Record<string, number>).score
      : 0), 0);
  const remainingCents = Math.round((totalScore - knownTotal) * 100);
  if (missing.length > 0 && remainingCents >= 0) {
    const baseCents = Math.floor(remainingCents / missing.length);
    missing.forEach(({ item }, index) => {
      (item as Record<string, unknown>).score = (baseCents + (index < remainingCents % missing.length ? 1 : 0)) / 100;
    });
  }
  return { ...output, subquestions };
}, z.object({
  status: promptStatusSchema, slotId: z.string().min(1), questionType: z.string().min(1),
  stem: z.array(generatedContentBlockSchema).min(1),
  options: z.array(z.object({ id: z.string().min(1), content: z.array(generatedContentBlockSchema).min(1) }).strict()),
  subquestions: z.array(z.object({ id: z.string().min(1), label: z.string().nullable(), stem: z.array(generatedContentBlockSchema).min(1), score: z.number().nonnegative() }).strict()),
  score: z.number().positive(), knowledgePointIds: z.array(z.string()).min(1), cognitiveLevel: z.string().min(1),
  difficulty: difficultyPromptSchema, sourceEvidence: z.array(evidenceSchema), originalityNotes: z.string().min(1), issues: z.array(promptIssueSchema),
}).strict());

export const questionGenerationPrompt: PromptDefinition<typeof questionGenerationInputSchema, typeof questionGenerationOutputSchema> = {
  id: 'question_generation_prompt', version: '1.0.4', stage: 'question_generation',
  task: '只为一个 GenerationPlan slot 生成题面。题面及小问必须实际覆盖 slot.knowledgePointIds 中的每一个考点，输出 knowledgePointIds 必须与 slot.knowledgePointIds 完全一致，不得只保留第一个考点或用标签冒充内容覆盖。若提供 variationAxis，必须沿该轴改变设问形态，不能只替换原题数字。内容块 type 只能是 paragraph、math、table、image、code、material。每个 subquestion 只能包含 id、label、stem、score，且所有小问 score 之和必须等于题目 score；没有小问时返回空数组。输出 Schema 故意不含 answer、explanation、rubric 或渲染格式；禁止输出这些内容，也不得复制历史题。',
  inputSchema: questionGenerationInputSchema, outputSchema: questionGenerationOutputSchema,
  outputContract: { status: 'ok|uncertain', slotId: 'string', questionType: 'string', stem: 'ContentBlock[]', options: 'Option[]', subquestions: 'Subquestion[]', score: 'number', knowledgePointIds: 'string[]', cognitiveLevel: 'string', difficulty: 'DifficultyAssessment', sourceEvidence: 'Evidence[]', originalityNotes: 'string', issues: 'Issue[]', additionalProperties: false, forbiddenFields: ['answer', 'explanation', 'rubric'] },
  splitInput: input => ({ trustedContext: { course: input.course, slot: input.slot, forbiddenQuestionIds: input.forbiddenQuestions.map(q => q.questionId) }, untrustedData: { referenceMaterials: input.referenceMaterials, forbiddenQuestions: input.forbiddenQuestions } }),
  examples: {
    correct: { status: 'ok', slotId: 'set1-q1', questionType: 'short_answer', stem: [{ type: 'paragraph', content: '结合材料说明核心概念。', assetId: null }], options: [], subquestions: [], score: 5, knowledgePointIds: ['kp-1'], cognitiveLevel: 'understand', difficulty: { difficultyLevel: 'basic', difficultyScore: 0.3, difficultySource: 'predicted', difficultyReason: '单一概念解释', confidence: 0.8, empiricalSampleSize: null }, sourceEvidence: [{ sourceDocumentId: 12, pageNumber: 2, blockId: 'm1', quote: '核心概念定义' }], originalityNotes: '使用新情境，未复用历史题句式', issues: [] },
    exceptional: { status: 'uncertain', slotId: 'set1-q1', questionType: 'short_answer', stem: [{ type: 'paragraph', content: '无法在当前材料范围内形成可靠题面', assetId: null }], options: [], subquestions: [], score: 5, knowledgePointIds: ['kp-1'], cognitiveLevel: 'understand', difficulty: { difficultyLevel: 'basic', difficultyScore: 0.3, difficultySource: 'predicted', difficultyReason: '计划目标值，仅作占位', confidence: 0.1, empiricalSampleSize: null }, sourceEvidence: [], originalityNotes: '未生成可交付题目', issues: [{ code: 'INSUFFICIENT_SOURCE_MATERIAL', message: '材料不足，题目需重新规划', evidence: ['slot:set1-q1'] }] },
  },
};
