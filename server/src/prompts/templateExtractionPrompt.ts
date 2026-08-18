import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const templateExtractionInputSchema = z.object({
  course: z.object({ id: z.number().int().positive(), name: z.string().min(1) }).strict(),
  sourceExams: z.array(z.object({ id: z.number().int().positive(), title: z.string().min(1), durationMinutes: z.number().int().positive().nullable(), instructions: z.array(z.string()) }).strict()).min(1),
  questions: z.array(z.object({ sourceExamId: z.number().int().positive(), questionNo: z.string().min(1), questionType: z.string().min(1), score: z.number().nonnegative().nullable(), sectionTitle: z.string().nullable(), evidence: z.array(evidenceSchema) }).strict()).min(1),
  renderingEvidence: z.array(z.object({ sourceExamId: z.number().int().positive(), text: z.string(), evidence: z.array(evidenceSchema) }).strict()),
}).strict();

const sectionOutputSchema = z.object({ id: z.string().min(1), title: z.string().min(1), questionType: z.string().min(1), questionCount: z.number().int().positive(), scorePerQuestion: z.number().positive().nullable(), subtotal: z.number().nonnegative(), order: z.number().int().positive(), optionalRule: z.string().nullable(), evidence: z.array(evidenceSchema) }).strict();

export const templateExtractionOutputSchema = z.object({
  status: promptStatusSchema,
  assessmentTemplate: z.object({ sections: z.array(sectionOutputSchema), totalScore: z.number().positive().nullable(), durationMinutes: z.number().int().positive().nullable(), instructions: z.array(z.string()), optionalRules: z.array(z.string()) }).strict(),
  renderingTemplate: z.object({ titlePattern: z.string().nullable(), schoolName: z.string().nullable(), courseInfoFields: z.array(z.string()), header: z.string().nullable(), footer: z.string().nullable(), studentInfoFields: z.array(z.string()), sealedLine: z.boolean().nullable(), answerPageDescription: z.string().nullable(), scoringColumns: z.array(z.string()) }).strict(),
  confidence: z.number().min(0).max(1), issues: z.array(promptIssueSchema),
}).strict();

export const templateExtractionPrompt: PromptDefinition<typeof templateExtractionInputSchema, typeof templateExtractionOutputSchema> = {
  id: 'template_extraction_prompt', version: '1.0.0', stage: 'exam_template_extraction',
  task: '只从已切分历史试卷提取 AssessmentTemplate 和 RenderingTemplate。不得生成新题，不得把缺失的总分或时长默认成 100 或 120。',
  inputSchema: templateExtractionInputSchema, outputSchema: templateExtractionOutputSchema,
  outputContract: { status: 'ok|uncertain', assessmentTemplate: 'AssessmentTemplate', renderingTemplate: 'RenderingTemplate', confidence: '0..1', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { course: input.course, sourceExamIds: input.sourceExams.map(e => e.id) }, untrustedData: { sourceExams: input.sourceExams, questions: input.questions, renderingEvidence: input.renderingEvidence } }),
  examples: {
    correct: { status: 'ok', assessmentTemplate: { sections: [{ id: 's1', title: '选择题', questionType: 'single_choice', questionCount: 10, scorePerQuestion: 2, subtotal: 20, order: 1, optionalRule: null, evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'h1', quote: '一、选择题（每题2分）' }] }], totalScore: 20, durationMinutes: 60, instructions: [], optionalRules: [] }, renderingTemplate: { titlePattern: '{course}考试', schoolName: null, courseInfoFields: ['课程'], header: null, footer: null, studentInfoFields: ['姓名', '学号'], sealedLine: false, answerPageDescription: null, scoringColumns: [] }, confidence: 0.94, issues: [] },
    exceptional: { status: 'uncertain', assessmentTemplate: { sections: [], totalScore: null, durationMinutes: null, instructions: [], optionalRules: [] }, renderingTemplate: { titlePattern: null, schoolName: null, courseInfoFields: [], header: null, footer: null, studentInfoFields: [], sealedLine: null, answerPageDescription: null, scoringColumns: [] }, confidence: 0.1, issues: [{ code: 'MISSING_SCORE_STRUCTURE', message: '历史题没有可靠分值标注', evidence: ['exam:20'] }] },
  },
};
