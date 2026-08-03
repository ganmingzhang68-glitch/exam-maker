import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

const pageSchema = z.object({ pageNumber: z.number().int().positive(), text: z.string(), blockIds: z.array(z.string()) }).strict();
const parsedPartSchema = z.object({
  label: z.string().nullable(), rawStem: z.string(), originalScore: z.number().nonnegative().nullable(), confidence: z.number().min(0).max(1),
}).strict();

export const questionParsingInputSchema = z.object({
  sourceExamId: z.number().int().positive(),
  sourceDocumentId: z.number().int().positive(),
  questionSections: z.array(z.object({ id: z.string(), pageStart: z.number().int().positive(), pageEnd: z.number().int().positive() }).strict()).min(1),
  pages: z.array(pageSchema).min(1),
}).strict();

export const questionParsingOutputSchema = z.object({
  status: promptStatusSchema,
  sourceExamId: z.number().int().positive(),
  questions: z.array(z.object({
    temporaryId: z.string().min(1), sourceDocumentId: z.number().int().positive(),
    pageStart: z.number().int().positive(), pageEnd: z.number().int().positive(),
    originalQuestionNo: z.string().min(1), rawStem: z.string().min(1),
    questionType: z.enum(['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'calculation', 'proof', 'essay', 'material', 'code', 'composite', 'unknown']),
    options: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) }).strict()),
    subquestions: z.array(parsedPartSchema), originalScore: z.number().nonnegative().nullable(),
    contentReferences: z.array(z.object({ kind: z.enum(['image', 'formula', 'table', 'code', 'material']), reference: z.string().min(1) }).strict()),
    confidence: z.number().min(0).max(1), evidence: z.array(evidenceSchema).min(1),
  }).strict()),
  issues: z.array(promptIssueSchema),
}).strict();

export const questionParsingPrompt: PromptDefinition<typeof questionParsingInputSchema, typeof questionParsingOutputSchema> = {
  id: 'question_parsing_prompt', version: '1.0.0', stage: 'exam_structure_parsing',
  task: '只从已识别的试题区段切分原题并保留来源定位。不要生成或推断答案、考点、难度、认知层级。',
  inputSchema: questionParsingInputSchema, outputSchema: questionParsingOutputSchema,
  outputContract: { status: 'ok|uncertain', sourceExamId: 'integer', questions: 'ParsedQuestion[]', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { sourceExamId: input.sourceExamId, sourceDocumentId: input.sourceDocumentId, questionSections: input.questionSections }, untrustedData: { pages: input.pages } }),
  examples: {
    correct: { status: 'ok', sourceExamId: 20, questions: [{
      temporaryId: 'q-1', sourceDocumentId: 10, pageStart: 1, pageEnd: 1, originalQuestionNo: '1', rawStem: '下列说法正确的是',
      questionType: 'single_choice', options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }], subquestions: [], originalScore: 2,
      contentReferences: [], confidence: 0.97, evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'b2', quote: '1. 下列说法正确的是' }],
    }], issues: [] },
    exceptional: { status: 'uncertain', sourceExamId: 20, questions: [], issues: [{ code: 'QUESTION_BOUNDARY_AMBIGUOUS', message: '跨页题号缺失，不能可靠切题', evidence: ['document:10/pages:1-2'] }] },
  },
};
