import { createHash } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { CourseGradingCalibration, GradingCalibrationMetric } from '@exam-maker/shared';
import { assessmentConfig } from '../config/assessment.js';
import { db, saveToDisk, schema } from '../db/index.js';

export interface CalibrationRow {
  aiScore: number;
  teacherScore: number;
  decision: 'accepted' | 'modified';
  questionType: string;
  rubricKey: string;
}

export function calculateGradingCalibration(rows: CalibrationRow[], key = 'all', label = '全部'): GradingCalibrationMetric {
  const minimum = assessmentConfig.minimumGradingCalibrationRecords;
  if (rows.length < minimum) return { key, label, sampleSize: rows.length, status: 'insufficient_sample',
    mae: null, bias: null, acceptanceRate: null, modificationRate: null };
  const differences = rows.map(row => row.aiScore - row.teacherScore);
  const accepted = rows.filter(row => row.decision === 'accepted').length;
  return { key, label, sampleSize: rows.length, status: 'available',
    mae: differences.reduce((sum, value) => sum + Math.abs(value), 0) / rows.length,
    bias: differences.reduce((sum, value) => sum + value, 0) / rows.length,
    acceptanceRate: accepted / rows.length, modificationRate: (rows.length - accepted) / rows.length };
}

function rubricKey(value: string | null, questionId: number): string {
  if (!value) return `question-${questionId}-no-rubric`;
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function grouped(rows: CalibrationRow[], field: 'questionType' | 'rubricKey'): GradingCalibrationMetric[] {
  const map = new Map<string, CalibrationRow[]>();
  rows.forEach(row => map.set(row[field], [...(map.get(row[field]) ?? []), row]));
  return [...map.entries()].map(([key, values]) => calculateGradingCalibration(values, key,
    field === 'questionType' ? key : `Rubric ${key}`));
}

export function getCourseGradingCalibration(courseId: number): CourseGradingCalibration {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get()!;
  const selected = db.select({ suggestion: schema.aiGradingSuggestions, question: schema.questions })
    .from(schema.aiGradingSuggestions)
    .innerJoin(schema.answers, eq(schema.aiGradingSuggestions.answerId, schema.answers.id))
    .innerJoin(schema.attempts, eq(schema.answers.attemptId, schema.attempts.id))
    .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .innerJoin(schema.paperQuestions, eq(schema.answers.paperQuestionId, schema.paperQuestions.id))
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(and(
      or(eq(schema.papers.courseId, courseId), and(isNull(schema.papers.courseId),
        eq(schema.papers.createdBy, course.ownerUserId), eq(schema.papers.course, course.name))),
      or(eq(schema.aiGradingSuggestions.status, 'accepted'), eq(schema.aiGradingSuggestions.status, 'modified')),
    )).all();
  const rows: CalibrationRow[] = selected.flatMap(({ suggestion, question }) =>
    suggestion.suggestedScore === null || suggestion.teacherFinalScore === null ? [] : [{
      aiScore: suggestion.suggestedScore, teacherScore: suggestion.teacherFinalScore,
      decision: suggestion.status as 'accepted' | 'modified', questionType: question.type,
      rubricKey: rubricKey(question.scoringRubric, question.id),
    }]);
  const summary = calculateGradingCalibration(rows);
  const now = new Date().toISOString();
  const persisted = db.insert(schema.gradingCalibrations).values({ courseId, sampleSize: summary.sampleSize,
    status: summary.status, mae: summary.mae, bias: summary.bias, acceptanceRate: summary.acceptanceRate,
    modificationRate: summary.modificationRate, computedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.gradingCalibrations.courseId, set: { sampleSize: summary.sampleSize,
      status: summary.status, mae: summary.mae, bias: summary.bias, acceptanceRate: summary.acceptanceRate,
      modificationRate: summary.modificationRate, computedAt: now, updatedAt: now } }).returning().get();
  saveToDisk();
  return { ...summary, courseId, minimumSampleSize: assessmentConfig.minimumGradingCalibrationRecords,
    computedAt: persisted.computedAt, byQuestionType: grouped(rows, 'questionType'), byRubric: grouped(rows, 'rubricKey') };
}
