import type { AnswerContent, PracticeSession, QuestionType } from '@exam-maker/shared';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { gradeObjectiveAnswer, isObjectiveType } from './grading.js';
import { syncStudentCourseMastery } from './knowledgeMastery.js';

type PracticeMode = 'wrong_questions' | 'knowledge_point' | 'weak_points';
type QuestionRow = typeof schema.questions.$inferSelect;

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function pointIdsForQuestion(question: QuestionRow, points: Array<typeof schema.knowledgePoints.$inferSelect>): number[] {
  const names = new Set((parseJson<string[]>(question.knowledgePoints, [])).map(value => value.trim().toLocaleLowerCase()));
  return points.filter(point => {
    const candidates = [point.name, point.code, ...parseJson<string[]>(point.aliases, [])];
    return candidates.some(value => names.has(value.trim().toLocaleLowerCase()));
  }).map(point => point.id);
}

function canAccessCourse(studentId: number, courseId: number): boolean {
  return Boolean(db.select({ id: schema.enrollments.id }).from(schema.enrollments)
    .innerJoin(schema.teachingClasses, eq(schema.enrollments.classId, schema.teachingClasses.id))
    .where(and(eq(schema.enrollments.studentId, studentId), eq(schema.enrollments.status, 'active'),
      eq(schema.teachingClasses.courseId, courseId), eq(schema.teachingClasses.status, 'active'))).limit(1).get());
}

function wrongQuestionIds(studentId: number, courseId: number): Set<number> {
  const rows = db.select({ questionId: schema.questions.id, answer: schema.answers, paperQuestion: schema.paperQuestions })
    .from(schema.answers).innerJoin(schema.attempts, eq(schema.answers.attemptId, schema.attempts.id))
    .innerJoin(schema.paperQuestions, eq(schema.answers.paperQuestionId, schema.paperQuestions.id))
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(and(eq(schema.attempts.studentId, studentId), eq(schema.attempts.status, 'graded'),
      eq(schema.questions.courseId, courseId))).all();
  return new Set(rows.filter(row => row.answer.isCorrect === false || (
    row.answer.finalScore !== null && row.paperQuestion.score > 0 && row.answer.finalScore / row.paperQuestion.score < 0.6
  )).map(row => row.questionId));
}

export interface CreatePracticeInput {
  courseId: number;
  mode: PracticeMode;
  knowledgePointId?: number | null;
  questionCount: number;
  difficulty?: 'basic' | 'medium' | 'hard' | null;
}

export function createPracticeSession(studentId: number, input: CreatePracticeInput): PracticeSession {
  if (!canAccessCourse(studentId, input.courseId)) throw new AppError(403, '尚未加入该课程，不能创建练习');
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, input.courseId)).get();
  if (!course) throw new AppError(404, '课程不存在');
  const points = db.select().from(schema.knowledgePoints).where(eq(schema.knowledgePoints.courseId, input.courseId)).all()
    .filter(point => point.status !== 'archived' && !point.mergedIntoId);
  if (input.knowledgePointId && !points.some(point => point.id === input.knowledgePointId)) {
    throw new AppError(400, '知识点不属于当前课程');
  }
  const targetPointIds = new Set<number>();
  if (input.mode === 'knowledge_point') targetPointIds.add(input.knowledgePointId!);
  if (input.mode === 'weak_points') {
    syncStudentCourseMastery(studentId, input.courseId).filter(row => row.masteryLevel === 'weak' || row.masteryLevel === 'developing')
      .forEach(row => targetPointIds.add(row.knowledgePointId));
  }
  const wrongIds = input.mode === 'wrong_questions' ? wrongQuestionIds(studentId, input.courseId) : null;
  const previouslyUsed = new Set(db.select({ questionId: schema.practiceAttempts.questionId }).from(schema.practiceAttempts)
    .innerJoin(schema.practiceSessions, eq(schema.practiceAttempts.sessionId, schema.practiceSessions.id))
    .where(eq(schema.practiceSessions.studentId, studentId)).all().map(row => row.questionId));
  const candidates = db.select().from(schema.questions).where(and(
    eq(schema.questions.courseId, input.courseId),
    or(eq(schema.questions.status, 'reviewed'), eq(schema.questions.lifecycleStatus, 'approved'), eq(schema.questions.lifecycleStatus, 'reviewed')),
  )).all().filter(question => isObjectiveType(question.type as QuestionType) && Boolean(question.answerKey))
    .map(question => ({ question, pointIds: pointIdsForQuestion(question, points) }))
    .filter(({ question, pointIds }) => (!input.difficulty || question.difficulty === input.difficulty)
      && (!wrongIds || wrongIds.has(question.id))
      && (input.mode === 'wrong_questions' || [...targetPointIds].some(id => pointIds.includes(id))))
    .sort((a, b) => Number(previouslyUsed.has(a.question.id)) - Number(previouslyUsed.has(b.question.id)) || a.question.id - b.question.id)
    .slice(0, input.questionCount);
  const shortageCount = Math.max(0, input.questionCount - candidates.length);
  const now = new Date().toISOString();
  const inserted = db.insert(schema.practiceSessions).values({ studentId, courseId: input.courseId, mode: input.mode,
    knowledgePointId: input.knowledgePointId ?? null, requestedCount: input.questionCount, selectedCount: candidates.length,
    shortageCount, difficulty: input.difficulty ?? null, status: candidates.length ? 'in_progress' : 'planned',
    scorePossible: candidates.reduce((sum, item) => sum + Math.max(item.question.defaultScore, 1), 0),
    startedAt: candidates.length ? now : null, updatedAt: now }).returning().get();
  const shortages = shortageCount ? [{ code: candidates.length ? 'QUESTION_BANK_SHORTAGE' : 'NO_ELIGIBLE_QUESTIONS',
    message: candidates.length ? `题库仅找到 ${candidates.length} 道符合条件且可自动判分的已审核题目` : '题库没有符合条件且可自动判分的已审核题目',
    missingCount: shortageCount }] : [];
  db.insert(schema.practicePlans).values({ sessionId: inserted.id,
    requestedDistribution: JSON.stringify({ mode: input.mode, knowledgePointId: input.knowledgePointId ?? null, difficulty: input.difficulty ?? null, count: input.questionCount }),
    selectedDistribution: JSON.stringify({ count: candidates.length, objectiveOnly: true }),
    questionIds: JSON.stringify(candidates.map(item => item.question.id)), shortages: JSON.stringify(shortages), updatedAt: now }).run();
  candidates.forEach(({ question, pointIds }, index) => db.insert(schema.practiceAttempts).values({ sessionId: inserted.id,
    questionId: question.id, orderNo: index + 1, maxScore: Math.max(question.defaultScore, 1), knowledgePointIds: JSON.stringify(pointIds),
    questionSnapshot: JSON.stringify({ stem: question.stem, type: question.type, options: parseJson<string[] | null>(question.options, null),
      difficulty: question.difficulty, answerKey: parseJson<Record<string, unknown> | null>(question.answerKey, null), analysis: question.analysis }) }).run());
  saveToDisk();
  return getPracticeSession(studentId, inserted.id);
}

export function listPracticeSessions(studentId: number): PracticeSession[] {
  return db.select({ session: schema.practiceSessions, courseName: schema.courses.name }).from(schema.practiceSessions)
    .innerJoin(schema.courses, eq(schema.practiceSessions.courseId, schema.courses.id))
    .where(eq(schema.practiceSessions.studentId, studentId)).orderBy(desc(schema.practiceSessions.createdAt)).all()
    .map(({ session, courseName }) => ({ ...session, courseName }));
}

export function getPracticeSession(studentId: number, sessionId: number): PracticeSession {
  const row = db.select({ session: schema.practiceSessions, courseName: schema.courses.name }).from(schema.practiceSessions)
    .innerJoin(schema.courses, eq(schema.practiceSessions.courseId, schema.courses.id))
    .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.studentId, studentId))).get();
  if (!row) throw new AppError(404, '练习不存在');
  const planRow = db.select().from(schema.practicePlans).where(eq(schema.practicePlans.sessionId, sessionId)).get();
  const points = db.select().from(schema.knowledgePoints).where(eq(schema.knowledgePoints.courseId, row.session.courseId)).all();
  const pointNames = new Map(points.map(point => [point.id, point.name]));
  const completed = row.session.status === 'completed';
  const questions = db.select().from(schema.practiceAttempts).where(eq(schema.practiceAttempts.sessionId, sessionId))
    .orderBy(schema.practiceAttempts.orderNo).all().map(item => {
      const snapshot = parseJson<{ stem: string; type: QuestionType; options: string[] | null; difficulty: 'basic' | 'medium' | 'hard' | null; answerKey: Record<string, unknown> | null; analysis: string | null }>(item.questionSnapshot,
        { stem: '', type: 'single_choice', options: null, difficulty: null, answerKey: null, analysis: null });
      const pointIds = parseJson<number[]>(item.knowledgePointIds, []);
      return { id: item.id, questionId: item.questionId, orderNo: item.orderNo, stem: snapshot.stem, type: snapshot.type,
        options: snapshot.options, difficulty: snapshot.difficulty, maxScore: item.maxScore, knowledgePointIds: pointIds,
        knowledgePointNames: pointIds.map(id => pointNames.get(id)).filter((value): value is string => Boolean(value)),
        answerContent: parseJson<AnswerContent | null>(item.answerContent, null), score: item.score, isCorrect: item.isCorrect,
        status: item.status, ...(completed ? { answerKey: snapshot.answerKey, analysis: snapshot.analysis } : {}) };
    });
  return { ...row.session, courseName: row.courseName, plan: planRow ? { ...planRow,
    requestedDistribution: parseJson(planRow.requestedDistribution, {}), selectedDistribution: parseJson(planRow.selectedDistribution, {}),
    questionIds: parseJson(planRow.questionIds, []), shortages: parseJson(planRow.shortages, []) } : undefined, questions };
}

export function submitPracticeAnswer(studentId: number, sessionId: number, itemId: number, content: AnswerContent | null, timeSpentSeconds?: number | null): PracticeSession {
  const session = getPracticeSession(studentId, sessionId);
  if (session.status !== 'in_progress') throw new AppError(409, '当前练习不能继续作答');
  const item = db.select().from(schema.practiceAttempts).where(and(eq(schema.practiceAttempts.id, itemId), eq(schema.practiceAttempts.sessionId, sessionId))).get();
  if (!item) throw new AppError(404, '练习题不存在');
  const snapshot = parseJson<{ type: QuestionType; answerKey: Record<string, unknown> | null }>(item.questionSnapshot, { type: 'single_choice', answerKey: null });
  const result = gradeObjectiveAnswer(snapshot.type, content, snapshot.answerKey, item.maxScore);
  const now = new Date().toISOString();
  db.update(schema.practiceAttempts).set({ answerContent: JSON.stringify(content), score: result.score, isCorrect: result.correct,
    status: 'graded', timeSpentSeconds: timeSpentSeconds ?? null, answeredAt: now, updatedAt: now }).where(eq(schema.practiceAttempts.id, itemId)).run();
  const all = db.select().from(schema.practiceAttempts).where(eq(schema.practiceAttempts.sessionId, sessionId)).all();
  const scoreEarned = all.reduce((sum, answer) => sum + (answer.id === itemId ? result.score : answer.score ?? 0), 0);
  const finished = all.length > 0 && all.every(answer => answer.id === itemId || answer.status === 'graded');
  db.update(schema.practiceSessions).set({ scoreEarned, status: finished ? 'completed' : 'in_progress', completedAt: finished ? now : null, updatedAt: now })
    .where(eq(schema.practiceSessions.id, sessionId)).run();
  if (finished) syncStudentCourseMastery(studentId, session.courseId);
  saveToDisk();
  return getPracticeSession(studentId, sessionId);
}

export function getPracticeOptions(studentId: number) {
  const courses = db.select({ course: schema.courses }).from(schema.enrollments)
    .innerJoin(schema.teachingClasses, eq(schema.enrollments.classId, schema.teachingClasses.id))
    .innerJoin(schema.courses, eq(schema.teachingClasses.courseId, schema.courses.id))
    .where(and(eq(schema.enrollments.studentId, studentId), eq(schema.enrollments.status, 'active'), eq(schema.teachingClasses.status, 'active'))).all();
  return { courses: [...new Map(courses.map(({ course }) => [course.id, course])).values()].map(course => {
    const mastery = syncStudentCourseMastery(studentId, course.id);
    const levels = new Map(mastery.map(item => [item.knowledgePointId, item.masteryLevel]));
    return { id: course.id, name: course.name, knowledgePoints: db.select().from(schema.knowledgePoints).where(eq(schema.knowledgePoints.courseId, course.id)).all()
      .filter(point => point.status !== 'archived' && !point.mergedIntoId).map(point => ({ id: point.id, name: point.name, parentId: point.parentId, masteryLevel: levels.get(point.id) ?? null })) };
  }) };
}
