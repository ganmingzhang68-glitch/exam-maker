import type { TeachingAnalytics, TeachingAttentionStudent } from '@exam-maker/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, saveToDisk, schema } from '../db/index.js';
import { getTeacherCourseKnowledgeAnalytics, syncStudentCourseMastery } from './knowledgeMastery.js';

export const TEACHING_ANALYTICS_VERSION = 'deterministic-rules-v1';
const ATTENTION_RULES = [
  'missed_submission: 已发布考试存在任务但没有已提交/已批改作答',
  'score_decline: 最近一次正式考试得分率比前一次下降至少 15 个百分点',
  'persistent_weakness: 至少 2 个知识点处于 weak 状态',
];
function ratio(numerator: number, denominator: number) { return denominator > 0 ? numerator / denominator : null; }

export function generateTeachingAnalytics(courseId: number, generatedBy: number): TeachingAnalytics {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get()!;
  const students = db.select({ user: schema.users }).from(schema.enrollments)
    .innerJoin(schema.teachingClasses, eq(schema.enrollments.classId, schema.teachingClasses.id))
    .innerJoin(schema.users, eq(schema.enrollments.studentId, schema.users.id))
    .where(and(eq(schema.teachingClasses.courseId, courseId), eq(schema.enrollments.status, 'active'))).all()
    .map(row => row.user).filter((user, index, all) => all.findIndex(item => item.id === user.id) === index);
  const paperRows = db.select().from(schema.papers).where(eq(schema.papers.courseId, courseId)).all();
  const paperIds = paperRows.map(paper => paper.id);
  const examRows = paperIds.length ? db.select().from(schema.exams).where(inArray(schema.exams.paperId, paperIds)).all() : [];
  const published = examRows.filter(exam => exam.status === 'published' || exam.status === 'closed');
  const examIds = published.map(exam => exam.id);
  const assignments = examIds.length ? db.select().from(schema.examAssignments).where(inArray(schema.examAssignments.examId, examIds)).all() : [];
  const assignmentIds = assignments.map(item => item.id);
  const attempts = assignmentIds.length ? db.select().from(schema.attempts).where(inArray(schema.attempts.assignmentId, assignmentIds)).all()
    .filter(item => item.status === 'submitted' || item.status === 'grading' || item.status === 'graded') : [];
  const graded = attempts.filter(item => item.status === 'graded');
  const totalByPaper = new Map(paperRows.map(paper => [paper.id, paper.totalScore]));
  const paperByExam = new Map(examRows.map(exam => [exam.id, exam.paperId]));
  const rates = graded.map(item => ({ ...item, rate: ratio(item.totalScore, totalByPaper.get(paperByExam.get(item.examId)!) ?? 0) }));
  const knowledge = getTeacherCourseKnowledgeAnalytics(courseId);
  const practice = db.select().from(schema.practiceSessions).where(and(eq(schema.practiceSessions.courseId, courseId), eq(schema.practiceSessions.status, 'completed'))).all();
  const quality = examIds.length ? db.select().from(schema.questionQualityReports).where(inArray(schema.questionQualityReports.examId, examIds)).all() : [];
  const questions = db.select().from(schema.questions).where(eq(schema.questions.courseId, courseId)).all();
  const attentionStudents: TeachingAttentionStudent[] = students.map(student => {
    const ownAssignments = assignments.filter(item => item.studentId === student.id);
    const ownAttempts = attempts.filter(item => item.studentId === student.id);
    const ownRates = rates.filter(item => item.studentId === student.id && item.rate !== null).sort((a, b) => String(a.gradedAt).localeCompare(String(b.gradedAt)));
    const mastery = syncStudentCourseMastery(student.id, courseId);
    const weakCount = mastery.filter(item => item.masteryLevel === 'weak').length;
    const latest = ownRates.at(-1)?.rate ?? null; const previous = ownRates.at(-2)?.rate ?? null;
    const reasons: TeachingAttentionStudent['reasons'] = [];
    if (ownAssignments.some(item => !ownAttempts.some(attempt => attempt.assignmentId === item.id))) reasons.push('missed_submission');
    if (latest !== null && previous !== null && previous - latest >= 0.15) reasons.push('score_decline');
    if (weakCount >= 2) reasons.push('persistent_weakness');
    return { studentId: student.id, username: student.username, reasons, evidence: { assignedExamCount: ownAssignments.length,
      completedExamCount: new Set(ownAttempts.map(item => item.examId)).size, latestScoreRate: latest, previousScoreRate: previous, weakKnowledgePointCount: weakCount } };
  }).filter(item => item.reasons.length > 0);
  const summary: TeachingAnalytics['summary'] = {
    enrolledStudentCount: students.length, publishedExamCount: published.length, assignmentCount: assignments.length,
    gradedAttemptCount: graded.length, participationRate: ratio(new Set(attempts.map(item => item.assignmentId)).size, assignments.length),
    averageScoreRate: rates.length ? rates.reduce((sum, item) => sum + (item.rate ?? 0), 0) / rates.length : null,
    completedPracticeCount: practice.length,
    averagePracticeScoreRate: practice.length ? practice.reduce((sum, item) => sum + (ratio(item.scoreEarned, item.scorePossible) ?? 0), 0) / practice.length : null,
    lowQualityQuestionCount: quality.filter(item => JSON.parse(item.qualityFlags || '[]').length > 0).length,
    pendingQuestionReviewCount: questions.filter(item => item.lifecycleStatus === 'needs_review' || item.status === 'generated').length,
    weakKnowledgePoints: knowledge.items.filter(item => item.weakStudentCount > 0).sort((a, b) => b.weakStudentCount - a.weakStudentCount)
      .map(item => ({ knowledgePointId: item.knowledgePointId, name: item.knowledgePointName, averageScoreRate: item.averageScoreRate, weakStudentCount: item.weakStudentCount })),
  };
  const now = new Date().toISOString();
  const snapshot = db.insert(schema.teachingAnalyticsSnapshots).values({ courseId, generatedBy, calculationVersion: TEACHING_ANALYTICS_VERSION,
    inputCutoffAt: now, summaryJson: JSON.stringify(summary), attentionJson: JSON.stringify(attentionStudents), updatedAt: now }).returning().get();
  saveToDisk();
  return { id: snapshot.id, courseId, courseName: course.name, generatedAt: snapshot.createdAt,
    calculationVersion: snapshot.calculationVersion, summary, attentionStudents, rules: ATTENTION_RULES };
}

export function getLatestTeachingAnalytics(courseId: number, generatedBy: number): TeachingAnalytics {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get()!;
  const snapshot = db.select().from(schema.teachingAnalyticsSnapshots).where(eq(schema.teachingAnalyticsSnapshots.courseId, courseId))
    .orderBy(desc(schema.teachingAnalyticsSnapshots.createdAt), desc(schema.teachingAnalyticsSnapshots.id)).limit(1).get();
  if (!snapshot) return generateTeachingAnalytics(courseId, generatedBy);
  return { id: snapshot.id, courseId, courseName: course.name, generatedAt: snapshot.createdAt,
    calculationVersion: snapshot.calculationVersion, summary: JSON.parse(snapshot.summaryJson),
    attentionStudents: JSON.parse(snapshot.attentionJson), rules: ATTENTION_RULES };
}
