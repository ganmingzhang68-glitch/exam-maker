import type { NextFunction, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { manualGradeSchema, positiveIdSchema } from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getAttemptDetail, parsePaperSnapshot, serializeAttempt } from '../services/attemptSnapshot.js';
import {
  getQuestionSolution,
  gradeAttempt,
  isObjectiveType,
  recalculateAttemptScores,
} from '../services/grading.js';
import { latestAiGradingSuggestion, queueAiGradingSuggestion, runAiGradingSuggestion, serializeAiGradingSuggestion } from '../services/aiGrading.js';

function getOwnedExam(req: AuthRequest, examId: number) {
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, examId)).get();
  if (!exam) throw new AppError(404, '考试不存在');
  if (req.userRole !== 'admin' && exam.createdBy !== req.userId) {
    throw new AppError(403, '无权查看该考试成绩');
  }
  return exam;
}

function getExamAttempt(req: AuthRequest, examId: number, attemptId: number) {
  getOwnedExam(req, examId);
  let attempt = db.select().from(schema.attempts).where(and(
    eq(schema.attempts.id, attemptId),
    eq(schema.attempts.examId, examId),
  )).get();
  if (!attempt) throw new AppError(404, '作答记录不存在');
  if (attempt.status === 'in_progress' || attempt.status === 'not_started') {
    throw new AppError(409, '学生尚未提交试卷');
  }
  if (attempt.status === 'submitted') attempt = gradeAttempt(attempt.id);
  return attempt;
}

function teacherAttemptDetail(req: AuthRequest, examId: number, attemptId: number) {
  const exam = getOwnedExam(req, examId);
  const attempt = getExamAttempt(req, examId, attemptId);
  const detail = getAttemptDetail(attempt.id);
  const student = db.select({
    id: schema.users.id,
    username: schema.users.username,
    email: schema.users.email,
  }).from(schema.users).where(eq(schema.users.id, attempt.studentId)).get();
  if (!student) throw new AppError(404, '学生不存在');
  const answerByQuestion = new Map(detail.answers.map((answer) => [answer.paperQuestionId, answer]));
  return {
    attempt: { ...detail.attempt, ...serializeAttempt(attempt) },
    student,
    exam: { id: exam.id, title: exam.title, status: exam.status },
    paper: detail.paper,
    questions: detail.questions.map((question) => {
      const answer = answerByQuestion.get(question.paperQuestionId);
      if (!answer) throw new AppError(409, '答题记录不完整，请重新执行判分');
      const solution = getQuestionSolution(question.paperQuestionId);
      return {
        ...question,
        answer,
        ...solution,
        subjective: !isObjectiveType(question.type),
        aiSuggestion: latestAiGradingSuggestion(answer.id),
      };
    }),
  };
}

export function listExamResults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    getOwnedExam(req, examId);
    const assignments = db.select({
      assignment: schema.examAssignments,
      student: {
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
      },
    }).from(schema.examAssignments)
      .innerJoin(schema.users, eq(schema.examAssignments.studentId, schema.users.id))
      .where(eq(schema.examAssignments.examId, examId))
      .all();
    const data = assignments.map(({ assignment, student }) => ({
      assignmentId: assignment.id,
      student,
      attempts: db.select().from(schema.attempts).where(and(
        eq(schema.attempts.examId, examId),
        eq(schema.attempts.studentId, student.id),
      )).orderBy(desc(schema.attempts.attemptNo)).all().map(serializeAttempt),
    }));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export function getTeacherAttemptResult(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const attemptId = positiveIdSchema.parse(req.params.attemptId);
    res.json({ success: true, data: teacherAttemptDetail(req, examId, attemptId) });
  } catch (error) { next(error); }
}

export function gradeSubjectiveAnswer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const attemptId = positiveIdSchema.parse(req.params.attemptId);
    const answerId = positiveIdSchema.parse(req.params.answerId);
    const attempt = getExamAttempt(req, examId, attemptId);
    const data = manualGradeSchema.parse(req.body);
    const answer = db.select().from(schema.answers).where(and(
      eq(schema.answers.id, answerId),
      eq(schema.answers.attemptId, attemptId),
    )).get();
    if (!answer) throw new AppError(404, '答案不存在');
    const snapshot = parsePaperSnapshot(attempt.paperSnapshot);
    const question = snapshot?.questions.find((item) => item.paperQuestionId === answer.paperQuestionId);
    if (!question) throw new AppError(409, '作答快照中不存在该题目');
    if (isObjectiveType(question.type)) throw new AppError(409, '客观题不能人工改分');
    if (data.score > question.score) throw new AppError(400, `人工评分不能超过题目满分 ${question.score}`);
    let suggestion: typeof schema.aiGradingSuggestions.$inferSelect | null = null;
    if (data.gradingMode !== 'manual') {
      if (!data.aiSuggestionId) throw new AppError(400, '接受或修改 AI 建议时必须提供建议 ID');
      suggestion = db.select().from(schema.aiGradingSuggestions).where(and(
        eq(schema.aiGradingSuggestions.id, data.aiSuggestionId), eq(schema.aiGradingSuggestions.answerId, answer.id),
      )).get() ?? null;
      if (!suggestion || suggestion.suggestedScore === null || !['succeeded', 'accepted', 'modified'].includes(suggestion.status)) {
        throw new AppError(409, 'AI 评分建议不存在或尚未完成');
      }
      if (data.gradingMode === 'accept_ai' && Math.abs(data.score - suggestion.suggestedScore) > 1e-6) {
        throw new AppError(400, '接受 AI 建议时教师得分必须等于建议分');
      }
    }
    const now = new Date().toISOString();
    db.update(schema.answers).set({
      manualScore: data.score,
      finalScore: data.score,
      gradingStatus: 'manual_graded',
      feedback: data.feedback ?? null,
      gradedBy: req.userId!,
      gradedAt: now,
      updatedAt: now,
    }).where(eq(schema.answers.id, answer.id)).run();
    if (suggestion) {
      db.update(schema.aiGradingSuggestions).set({
        status: data.gradingMode === 'accept_ai' ? 'accepted' : 'modified', teacherFinalScore: data.score,
        scoreDifference: data.score - suggestion.suggestedScore!, reviewedBy: req.userId!, reviewedAt: now, updatedAt: now,
      }).where(eq(schema.aiGradingSuggestions.id, suggestion.id)).run();
    }
    recalculateAttemptScores(attemptId);
    saveToDisk();
    res.json({ success: true, data: teacherAttemptDetail(req, examId, attemptId) });
  } catch (error) { next(error); }
}

export function requestAiGradingSuggestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const attemptId = positiveIdSchema.parse(req.params.attemptId);
    const answerId = positiveIdSchema.parse(req.params.answerId);
    const attempt = getExamAttempt(req, examId, attemptId);
    const answer = db.select().from(schema.answers).where(and(eq(schema.answers.id, answerId), eq(schema.answers.attemptId, attempt.id))).get();
    if (!answer) throw new AppError(404, '答案不存在');
    const snapshot = parsePaperSnapshot(attempt.paperSnapshot);
    const question = snapshot?.questions.find(item => item.paperQuestionId === answer.paperQuestionId);
    if (!question || isObjectiveType(question.type)) throw new AppError(409, '仅主观题支持 AI 评分建议');
    const suggestion = queueAiGradingSuggestion(answerId);
    if (suggestion.status === 'queued') setTimeout(() => { void runAiGradingSuggestion(suggestion.id); }, 0);
    res.status(202).json({ success: true, data: suggestion });
  } catch (error) { next(error); }
}

export function getAiGradingSuggestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const attemptId = positiveIdSchema.parse(req.params.attemptId);
    const answerId = positiveIdSchema.parse(req.params.answerId);
    getExamAttempt(req, examId, attemptId);
    const answer = db.select().from(schema.answers).where(and(eq(schema.answers.id, answerId), eq(schema.answers.attemptId, attemptId))).get();
    if (!answer) throw new AppError(404, '答案不存在');
    const row = db.select().from(schema.aiGradingSuggestions).where(eq(schema.aiGradingSuggestions.answerId, answerId))
      .orderBy(desc(schema.aiGradingSuggestions.id)).get();
    if (!row) throw new AppError(404, '尚未生成 AI 评分建议');
    res.json({ success: true, data: serializeAiGradingSuggestion(row) });
  } catch (error) { next(error); }
}

export function getStudentAttemptResult(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const attemptId = positiveIdSchema.parse(req.params.id);
    let attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId)).get();
    if (!attempt) throw new AppError(404, '作答记录不存在');
    if (attempt.studentId !== req.userId) throw new AppError(403, '无权查看其他学生成绩');
    if (attempt.status === 'in_progress' || attempt.status === 'not_started') {
      throw new AppError(409, '试卷尚未提交');
    }
    if (attempt.status === 'submitted') attempt = gradeAttempt(attempt.id);
    const exam = db.select().from(schema.exams).where(eq(schema.exams.id, attempt.examId)).get();
    if (!exam) throw new AppError(404, '考试不存在');
    const detail = getAttemptDetail(attempt.id);
    const answerByQuestion = new Map(detail.answers.map((answer) => [answer.paperQuestionId, answer]));
    const questions = detail.questions.map((question) => {
      const answer = answerByQuestion.get(question.paperQuestionId);
      if (!answer) throw new AppError(409, '答题记录不完整');
      const solution = getQuestionSolution(question.paperQuestionId);
      return {
        ...question,
        answer,
        ...(exam.showAnswers ? { answerKey: solution.answerKey } : {}),
        ...(exam.showAnalysis ? { analysis: solution.analysis } : {}),
      };
    });
    res.json({
      success: true,
      data: {
        attempt: { ...detail.attempt, ...serializeAttempt(attempt) },
        exam: {
          id: exam.id,
          title: exam.title,
          status: exam.status,
          showAnswers: exam.showAnswers,
          showAnalysis: exam.showAnalysis,
        },
        paper: detail.paper,
        questions,
      },
    });
  } catch (error) { next(error); }
}
