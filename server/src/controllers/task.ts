import type { NextFunction, Response } from 'express';
import { positiveIdSchema, taskKindSchema, taskListQuerySchema } from '@exam-maker/shared';
import { eq } from 'drizzle-orm';
import { db, saveToDisk, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { getTask, listTasks } from '../services/taskService.js';
import { cancelSimilarQuestionJob, retrySimilarQuestionJob } from '../services/similarQuestionPipeline.js';
import { startWorkflow } from '../services/workflow.js';

function owned(req: AuthRequest) {
  const kind = taskKindSchema.parse(req.params.kind);
  const id = positiveIdSchema.parse(req.params.id);
  const task = getTask(kind, id, req.userId!, req.userRole === 'admin');
  if (!task) throw new AppError(404, '任务不存在或无权访问');
  return { kind, id, task };
}

export function listTaskController(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = taskListQuerySchema.parse(req.query);
    const rows = listTasks(req.userId!, req.userRole === 'admin')
      .filter(row => !query.status || row.status === query.status)
      .slice(query.offset, query.offset + query.limit);
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
}

export function getTaskController(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: owned(req).task }); } catch (error) { next(error); }
}

export function cancelTaskController(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { kind, id, task } = owned(req);
    if (!['queued', 'running', 'retrying'].includes(task.status)) throw new AppError(409, '当前任务状态不允许取消');
    if (kind === 'similar_question') cancelSimilarQuestionJob(id);
    else {
      const now = new Date().toISOString();
      db.update(schema.generationJobs).set({ taskStatus: 'cancelled', cancelRequestedAt: now, finishedAt: now, updatedAt: now })
        .where(eq(schema.generationJobs.id, id)).run();
      saveToDisk();
    }
    res.json({ success: true, data: getTask(kind, id, req.userId!, req.userRole === 'admin') });
  } catch (error) { next(error); }
}

export function retryTaskController(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { kind, id, task } = owned(req);
    if (!['failed', 'cancelled', 'blocked'].includes(task.status)) throw new AppError(409, '当前任务状态不允许重试');
    if (kind === 'similar_question') retrySimilarQuestionJob(id);
    else {
      const now = new Date().toISOString();
      const job = db.update(schema.generationJobs).set({ taskStatus: 'retrying', status: 'pending', errorSummary: null,
        cancelRequestedAt: null, finishedAt: null, updatedAt: now }).where(eq(schema.generationJobs.id, id)).returning().get();
      saveToDisk();
      if (job) setTimeout(() => { void startWorkflow(job.projectId); }, 0);
    }
    res.status(202).json({ success: true, data: getTask(kind, id, req.userId!, req.userRole === 'admin') });
  } catch (error) { next(error); }
}
