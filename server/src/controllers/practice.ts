import type { NextFunction, Response } from 'express';
import { createPracticeSessionSchema, positiveIdSchema, submitPracticeAnswerSchema } from '@exam-maker/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { createPracticeSession, getPracticeOptions, getPracticeSession, listPracticeSessions, submitPracticeAnswer } from '../services/practice.js';

export function options(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: getPracticeOptions(req.userId!) }); } catch (error) { next(error); }
}
export function list(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: listPracticeSessions(req.userId!) }); } catch (error) { next(error); }
}
export function create(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: createPracticeSession(req.userId!, createPracticeSessionSchema.parse(req.body)) }); }
  catch (error) { next(error); }
}
export function detail(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: getPracticeSession(req.userId!, positiveIdSchema.parse(req.params.id)) }); }
  catch (error) { next(error); }
}
export function answer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = submitPracticeAnswerSchema.parse(req.body);
    res.json({ success: true, data: submitPracticeAnswer(req.userId!, positiveIdSchema.parse(req.params.id),
      positiveIdSchema.parse(req.params.itemId), body.content, body.timeSpentSeconds) });
  } catch (error) { next(error); }
}
