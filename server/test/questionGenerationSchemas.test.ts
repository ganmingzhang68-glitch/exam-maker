import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  assessmentTemplateSchema,
  difficultyAssessmentSchema,
  generatedQuestionSchema,
  generationStageSchema,
  rubricSchema,
  stageResultSchema,
} from '@exam-maker/shared';

const identity = {
  id: 1,
  status: 'draft' as const,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

const aiMetadata = {
  aiRunId: 1,
  provider: 'test-provider',
  model: 'test-model',
  promptVersionId: 1,
  parameters: { temperature: 0 },
};

test('pipeline exposes the fourteen ordered stage identifiers', () => {
  assert.deepEqual(generationStageSchema.options, [
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
});

test('empirical difficulty requires a real sample size', () => {
  const withoutSample = difficultyAssessmentSchema.safeParse({
    difficultyLevel: 'medium',
    difficultyScore: 0.55,
    difficultySource: 'empirical',
    difficultyReason: '历史答题统计',
    confidence: 0.8,
  });
  assert.equal(withoutSample.success, false);

  assert.equal(difficultyAssessmentSchema.safeParse({
    difficultyLevel: 'medium',
    difficultyScore: 0.55,
    difficultySource: 'predicted',
    difficultyReason: '模型根据步骤数预测',
    confidence: 0.8,
  }).success, true);
});

test('assessment template totals and section totals must agree', () => {
  const invalid = assessmentTemplateSchema.safeParse({
    sections: [{
      id: 'choice', title: '选择题', questionType: 'single_choice', questionCount: 10,
      scorePerQuestion: 2, subtotal: 10, order: 1, optionalRule: null,
    }],
    totalScore: 20,
    durationMinutes: 90,
  });
  assert.equal(invalid.success, false);
});

test('choice answer must reference an existing unique option', () => {
  const result = generatedQuestionSchema.safeParse({
    ...identity,
    generationPlanId: 1,
    planSlotId: 'set-1-q-1',
    setNo: 1,
    questionType: 'multiple_choice',
    stem: [{ type: 'paragraph', markdown: '选择正确说法。' }],
    options: [
      { id: 'A', content: [{ type: 'paragraph', markdown: '甲' }] },
      { id: 'B', content: [{ type: 'paragraph', markdown: '乙' }] },
    ],
    score: 4,
    answer: { kind: 'multiple_choice', optionIds: ['A', 'C'] },
    knowledgePointIds: [1],
    cognitiveLevel: 'understand',
    difficulty: {
      difficultyLevel: 'basic', difficultyScore: 0.25, difficultySource: 'predicted',
      difficultyReason: '基础概念辨析', confidence: 0.7,
    },
    rubricId: null,
    aiMetadata,
  });
  assert.equal(result.success, false);
});

test('rubric item points must equal the question score', () => {
  const invalid = rubricSchema.safeParse({
    ...identity,
    generatedQuestionId: 1,
    totalScore: 10,
    items: [{
      id: 'step-1', description: '列出关键公式', points: 4,
      partialCreditRule: null,
    }],
    generalRule: null,
    aiMetadata,
  });
  assert.equal(invalid.success, false);

  const valid = rubricSchema.safeParse({
    ...identity,
    generatedQuestionId: 1,
    totalScore: 10,
    items: [
      { id: 'step-1', description: '列出关键公式', points: 4, partialCreditRule: null },
      { id: 'step-2', description: '计算并给出结论', points: 6, partialCreditRule: null },
    ],
    generalRule: null,
    aiMetadata,
  });
  assert.equal(valid.success, true);
});

test('stage result cannot silently succeed or fail without its payload', () => {
  const schema = stageResultSchema(z.object({ documentId: z.number().int().positive() }));
  assert.equal(schema.safeParse({
    stage: 'document_extraction', status: 'succeeded', input: {}, output: null, errors: [],
  }).success, false);
  assert.equal(schema.safeParse({
    stage: 'document_extraction', status: 'failed', input: {}, output: null, errors: [],
  }).success, false);
  assert.equal(schema.safeParse({
    stage: 'document_extraction', status: 'succeeded', input: {}, output: { documentId: 1 }, errors: [],
  }).success, true);
});
