import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { MasteryLevel, StudentKnowledgeMastery, StudentLearningOverview, TeacherCourseKnowledgeAnalytics } from '@exam-maker/shared';
import { assessmentConfig } from '../config/assessment.js';
import { db, saveToDisk, schema } from '../db/index.js';

export const MASTERY_CALCULATION_VERSION = 'weighted-score-v1';

export interface MasteryEvidence {
  examId: number;
  earnedScore: number;
  possibleScore: number;
  assessedAt: string;
}

export function calculateMasteryEvidence(evidence: MasteryEvidence[], now = new Date()) {
  if (!evidence.length) return { scoreRate: null, recentScoreRate: null, weightedEarned: 0,
    weightedPossible: 0, questionCount: 0, assessmentCount: 0, masteryLevel: 'insufficient_data' as MasteryLevel, lastAssessedAt: null };
  let weightedEarned = 0; let weightedPossible = 0; let recentEarned = 0; let recentPossible = 0;
  for (const item of evidence) {
    const ageDays = Math.max(0, (now.getTime() - new Date(item.assessedAt).getTime()) / 86_400_000);
    const weight = 2 ** (-ageDays / assessmentConfig.masteryHalfLifeDays);
    weightedEarned += item.earnedScore * weight; weightedPossible += item.possibleScore * weight;
    if (ageDays <= assessmentConfig.masteryRecentDays) { recentEarned += item.earnedScore; recentPossible += item.possibleScore; }
  }
  const scoreRate = weightedPossible > 0 ? weightedEarned / weightedPossible : null;
  const recentScoreRate = recentPossible > 0 ? recentEarned / recentPossible : null;
  const masteryLevel: MasteryLevel = evidence.length < assessmentConfig.masteryMinimumQuestions || scoreRate === null
    ? 'insufficient_data' : scoreRate >= assessmentConfig.masteryMasteredRate ? 'mastered'
      : scoreRate >= assessmentConfig.masteryGoodRate ? 'good'
        : scoreRate >= assessmentConfig.masteryDevelopingRate ? 'developing' : 'weak';
  return { scoreRate, recentScoreRate, weightedEarned, weightedPossible, questionCount: evidence.length,
    assessmentCount: new Set(evidence.map(item => item.examId)).size, masteryLevel,
    lastAssessedAt: evidence.map(item => item.assessedAt).sort().at(-1) ?? null };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function questionPointMap(courseId: number, questionIds: number[], points: Array<typeof schema.knowledgePoints.$inferSelect>) {
  const result = new Map<number, Set<number>>();
  if (!questionIds.length || !points.length) return result;
  const pointByName = new Map<string, number>();
  points.forEach(point => {
    [point.name, point.code, ...(parseJson<string[]>(point.aliases) ?? [])].forEach(name => pointByName.set(name.trim().toLocaleLowerCase(), point.id));
  });
  const questions = db.select().from(schema.questions).where(inArray(schema.questions.id, questionIds)).all();
  questions.forEach(question => {
    const ids = new Set<number>();
    (parseJson<string[]>(question.knowledgePoints) ?? []).forEach(name => {
      const id = pointByName.get(name.trim().toLocaleLowerCase()); if (id) ids.add(id);
    });
    result.set(question.id, ids);
  });
  const generated = db.select({ id: schema.generatedQuestions.id, legacyQuestionId: schema.generatedQuestions.legacyQuestionId })
    .from(schema.generatedQuestions).where(inArray(schema.generatedQuestions.legacyQuestionId, questionIds)).all();
  if (generated.length) {
    const legacyByGenerated = new Map(generated.map(item => [item.id, item.legacyQuestionId!]));
    db.select().from(schema.questionClassifications).where(and(
      eq(schema.questionClassifications.questionKind, 'generated'),
      inArray(schema.questionClassifications.generatedQuestionId, generated.map(item => item.id)),
      inArray(schema.questionClassifications.knowledgePointId, points.map(point => point.id)),
    )).all().forEach(item => result.get(legacyByGenerated.get(item.generatedQuestionId!)!)?.add(item.knowledgePointId));
  }
  return result;
}

export function syncStudentCourseMastery(studentId: number, courseId: number): StudentKnowledgeMastery[] {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get();
  if (!course) return [];
  const points = db.select().from(schema.knowledgePoints).where(and(
    eq(schema.knowledgePoints.courseId, courseId), isNotNull(schema.knowledgePoints.name),
  )).all().filter(point => !point.mergedIntoId && point.status !== 'archived');
  const rows = db.select({ answer: schema.answers, attempt: schema.attempts, exam: schema.exams,
    paper: schema.papers, paperQuestion: schema.paperQuestions, question: schema.questions })
    .from(schema.answers).innerJoin(schema.attempts, eq(schema.answers.attemptId, schema.attempts.id))
    .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .innerJoin(schema.paperQuestions, eq(schema.answers.paperQuestionId, schema.paperQuestions.id))
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(and(eq(schema.attempts.studentId, studentId), eq(schema.attempts.status, 'graded'), isNotNull(schema.answers.finalScore),
      or(eq(schema.questions.courseId, courseId), eq(schema.papers.courseId, courseId), and(
        isNotNull(schema.papers.course), eq(schema.papers.createdBy, course.ownerUserId), eq(schema.papers.course, course.name),
      )))).all();
  const mapping = questionPointMap(courseId, [...new Set(rows.map(row => row.question.id))], points);
  const evidenceByPoint = new Map<number, MasteryEvidence[]>();
  rows.forEach(row => {
    const assessedAt = row.attempt.gradedAt ?? row.attempt.submittedAt ?? row.attempt.updatedAt;
    for (const pointId of mapping.get(row.question.id) ?? []) {
      evidenceByPoint.set(pointId, [...(evidenceByPoint.get(pointId) ?? []), { examId: row.exam.id,
        earnedScore: row.answer.finalScore!, possibleScore: row.paperQuestion.score, assessedAt }]);
    }
  });
  const now = new Date(); const updatedAt = now.toISOString();
  for (const point of points) {
    const metric = calculateMasteryEvidence(evidenceByPoint.get(point.id) ?? [], now);
    db.insert(schema.studentKnowledgeMastery).values({ studentId, courseId, knowledgePointId: point.id,
      scoreRate: metric.scoreRate, recentScoreRate: metric.recentScoreRate,
      weightedScoreEarned: metric.weightedEarned, weightedScorePossible: metric.weightedPossible,
      questionCount: metric.questionCount, assessmentCount: metric.assessmentCount,
      masteryLevel: metric.masteryLevel, lastAssessedAt: metric.lastAssessedAt,
      calculationVersion: MASTERY_CALCULATION_VERSION, updatedAt })
      .onConflictDoUpdate({ target: [schema.studentKnowledgeMastery.studentId, schema.studentKnowledgeMastery.courseId, schema.studentKnowledgeMastery.knowledgePointId],
        set: { scoreRate: metric.scoreRate, recentScoreRate: metric.recentScoreRate,
          weightedScoreEarned: metric.weightedEarned, weightedScorePossible: metric.weightedPossible,
          questionCount: metric.questionCount, assessmentCount: metric.assessmentCount,
          masteryLevel: metric.masteryLevel, lastAssessedAt: metric.lastAssessedAt,
          calculationVersion: MASTERY_CALCULATION_VERSION, updatedAt } }).run();
  }
  saveToDisk();
  const pointById = new Map(points.map(point => [point.id, point]));
  return db.select().from(schema.studentKnowledgeMastery).where(and(
    eq(schema.studentKnowledgeMastery.studentId, studentId), eq(schema.studentKnowledgeMastery.courseId, courseId),
  )).all().filter(row => pointById.has(row.knowledgePointId)).map(row => ({ ...row,
    courseName: course.name, knowledgePointName: pointById.get(row.knowledgePointId)!.name,
    parentKnowledgePointId: pointById.get(row.knowledgePointId)!.parentId, timeSpentSeconds: null }));
}

export function getStudentLearningOverview(studentId: number): StudentLearningOverview {
  const courses = db.select({ course: schema.courses }).from(schema.enrollments)
    .innerJoin(schema.teachingClasses, eq(schema.enrollments.classId, schema.teachingClasses.id))
    .innerJoin(schema.courses, eq(schema.teachingClasses.courseId, schema.courses.id))
    .where(and(eq(schema.enrollments.studentId, studentId), eq(schema.enrollments.status, 'active'))).all();
  const unique = [...new Map(courses.map(({ course }) => [course.id, course])).values()];
  return { configuration: { minimumQuestions: assessmentConfig.masteryMinimumQuestions,
    halfLifeDays: assessmentConfig.masteryHalfLifeDays, recentDays: assessmentConfig.masteryRecentDays },
    courses: unique.map(course => ({ courseId: course.id, courseName: course.name,
      knowledgePoints: syncStudentCourseMastery(studentId, course.id) })) };
}

export function getTeacherCourseKnowledgeAnalytics(courseId: number): TeacherCourseKnowledgeAnalytics {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get()!;
  const students = db.select({ id: schema.enrollments.studentId }).from(schema.enrollments)
    .innerJoin(schema.teachingClasses, eq(schema.enrollments.classId, schema.teachingClasses.id))
    .where(and(eq(schema.teachingClasses.courseId, courseId), eq(schema.enrollments.status, 'active'))).all();
  const studentIds = [...new Set(students.map(item => item.id))];
  studentIds.forEach(studentId => syncStudentCourseMastery(studentId, courseId));
  const points = db.select().from(schema.knowledgePoints).where(eq(schema.knowledgePoints.courseId, courseId)).all()
    .filter(point => !point.mergedIntoId && point.status !== 'archived');
  const records = studentIds.length ? db.select().from(schema.studentKnowledgeMastery).where(and(
    eq(schema.studentKnowledgeMastery.courseId, courseId), inArray(schema.studentKnowledgeMastery.studentId, studentIds),
  )).all() : [];
  return { courseId, courseName: course.name, enrolledStudentCount: studentIds.length, items: points.map(point => {
    const samples = records.filter(row => row.knowledgePointId === point.id && row.questionCount > 0 && row.scoreRate !== null);
    return { knowledgePointId: point.id, knowledgePointName: point.name, parentKnowledgePointId: point.parentId,
      averageScoreRate: samples.length ? samples.reduce((sum, row) => sum + row.scoreRate!, 0) / samples.length : null,
      studentCount: samples.length, weakStudentCount: samples.filter(row => row.masteryLevel === 'weak').length,
      questionCount: samples.reduce((sum, row) => sum + row.questionCount, 0),
      status: samples.length ? 'available' as const : 'insufficient_data' as const };
  }) };
}
