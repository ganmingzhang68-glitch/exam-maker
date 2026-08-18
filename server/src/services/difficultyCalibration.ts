import { and, eq, isNull, or } from 'drizzle-orm';
import type { CourseDifficultyCalibration, DifficultyCalibrationLabel } from '@exam-maker/shared';
import { assessmentConfig } from '../config/assessment.js';
import { db, saveToDisk, schema } from '../db/index.js';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export function classifyDifficultyPrediction(
  predicted: number | null,
  empirical: number,
  tolerance = assessmentConfig.calibrationTolerance,
): { error: number | null; label: DifficultyCalibrationLabel } {
  if (predicted === null) return { error: null, label: 'unavailable' };
  const error = predicted - empirical;
  if (Math.abs(error) <= tolerance) return { error, label: 'aligned' };
  return { error, label: error > 0 ? 'ai_overestimated' : 'ai_underestimated' };
}

export function calculateCalibrationSummary(errors: number[], minimumSampleSize = assessmentConfig.minimumCalibrationRecords) {
  if (errors.length < minimumSampleSize) {
    return { sampleSize: errors.length, status: 'insufficient_sample' as const, mae: null, rmse: null, bias: null };
  }
  return {
    sampleSize: errors.length,
    status: 'available' as const,
    mae: errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length),
    bias: errors.reduce((sum, value) => sum + value, 0) / errors.length,
  };
}

function generatedPrediction(questionId: number): number | null {
  const generated = db.select({ difficulty: schema.generatedQuestions.difficulty })
    .from(schema.generatedQuestions).where(eq(schema.generatedQuestions.legacyQuestionId, questionId)).get();
  const value = parseJson<{ difficultyScore?: unknown }>(generated?.difficulty ?? null)?.difficultyScore;
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : null;
}

function resolveCourseId(question: typeof schema.questions.$inferSelect, paper: typeof schema.papers.$inferSelect): number | null {
  if (question.courseId) return question.courseId;
  if (paper.courseId) return paper.courseId;
  return db.select({ id: schema.courses.id }).from(schema.courses).where(and(
    eq(schema.courses.ownerUserId, paper.createdBy), eq(schema.courses.name, paper.course),
  )).get()?.id ?? null;
}

export function syncDifficultyCalibrationsForExam(examId: number): void {
  const rows = db.select({
    report: schema.questionQualityReports,
    question: schema.questions,
    paper: schema.papers,
  }).from(schema.questionQualityReports)
    .innerJoin(schema.questions, eq(schema.questionQualityReports.questionId, schema.questions.id))
    .innerJoin(schema.exams, eq(schema.questionQualityReports.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(eq(schema.questionQualityReports.examId, examId)).all();
  const now = new Date().toISOString();
  for (const { report, question, paper } of rows) {
    if (report.metricStatus !== 'ok' || report.empiricalDifficulty === null) continue;
    const courseId = resolveCourseId(question, paper);
    if (!courseId) continue;
    const existing = db.select().from(schema.difficultyCalibrationRecords)
      .where(eq(schema.difficultyCalibrationRecords.questionQualityReportId, report.id)).get();
    const predicted = existing?.predictedDifficulty ?? question.predictedDifficultyScore ?? generatedPrediction(question.id);
    const comparison = classifyDifficultyPrediction(predicted, report.empiricalDifficulty);
    db.insert(schema.difficultyCalibrationRecords).values({
      courseId, questionId: question.id, questionQualityReportId: report.id,
      predictedDifficulty: predicted, teacherDifficulty: question.teacherDifficultyScore,
      empiricalDifficulty: report.empiricalDifficulty, sampleSize: report.sampleSize,
      predictionError: comparison.error, calibrationLabel: comparison.label, updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.difficultyCalibrationRecords.questionQualityReportId,
      set: { courseId, teacherDifficulty: question.teacherDifficultyScore,
        empiricalDifficulty: report.empiricalDifficulty, sampleSize: report.sampleSize,
        predictionError: comparison.error, calibrationLabel: comparison.label, updatedAt: now },
    }).run();
  }
  saveToDisk();
}

function refreshCourseCalibration(courseId: number): typeof schema.courseDifficultyCalibrations.$inferSelect {
  const records = db.select().from(schema.difficultyCalibrationRecords)
    .where(eq(schema.difficultyCalibrationRecords.courseId, courseId)).all();
  const summary = calculateCalibrationSummary(records.flatMap(record => record.predictionError === null ? [] : [record.predictionError]));
  const now = new Date().toISOString();
  return db.insert(schema.courseDifficultyCalibrations).values({ courseId, ...summary, computedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.courseDifficultyCalibrations.courseId,
      set: { ...summary, computedAt: now, updatedAt: now } }).returning().get();
}

export function getCourseDifficultyCalibration(courseId: number): CourseDifficultyCalibration {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get()!;
  const exams = db.select({ id: schema.exams.id }).from(schema.exams)
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(or(eq(schema.papers.courseId, courseId), and(
      isNull(schema.papers.courseId), eq(schema.papers.createdBy, course.ownerUserId), eq(schema.papers.course, course.name),
    ))).all();
  exams.forEach(exam => syncDifficultyCalibrationsForExam(exam.id));
  const aggregate = refreshCourseCalibration(courseId);
  const records = db.select({ record: schema.difficultyCalibrationRecords, stem: schema.questions.stem })
    .from(schema.difficultyCalibrationRecords)
    .innerJoin(schema.questions, eq(schema.difficultyCalibrationRecords.questionId, schema.questions.id))
    .where(eq(schema.difficultyCalibrationRecords.courseId, courseId)).all();
  return {
    courseId, sampleSize: aggregate.sampleSize, minimumSampleSize: assessmentConfig.minimumCalibrationRecords,
    status: aggregate.status, mae: aggregate.mae, rmse: aggregate.rmse, bias: aggregate.bias,
    computedAt: aggregate.computedAt,
    records: records.map(({ record, stem }) => ({
      id: record.id, questionId: record.questionId, questionQualityReportId: record.questionQualityReportId,
      questionStem: stem, predictedDifficulty: record.predictedDifficulty, teacherDifficulty: record.teacherDifficulty,
      empiricalDifficulty: record.empiricalDifficulty, sampleSize: record.sampleSize,
      predictionError: record.predictionError, calibrationLabel: record.calibrationLabel, createdAt: record.createdAt,
    })),
  };
}
