import { Request, Response, NextFunction } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, schema, rawDb, saveToDisk } from '../db/index.js';
import { createProjectSchema, checkpointActionSchema } from '@exam-maker/shared';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startWorkflow, continueWorkflow } from '../services/workflow.js';

// SSE clients registry: projectId -> Set of response objects
const sseClients = new Map<number, Set<Response>>();

export function addEvent(projectId: number, step: string, eventType: string, message: string, data?: Record<string, unknown>) {
  // Persist to DB
  db.insert(schema.jobEvents).values({
    projectId,
    step,
    eventType,
    message,
    data: data ? JSON.stringify(data) : null,
  }).run();
  saveToDisk();

  // Broadcast to SSE clients
  const clients = sseClients.get(projectId);
  if (clients) {
    const payload = `data: ${JSON.stringify({ step, eventType, message, data })}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }
}

// ====== CRUD ======
export function listProjects(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = db.select().from(schema.projects)
      .where(eq(schema.projects.userId, req.userId!))
      .orderBy(desc(schema.projects.updatedAt))
      .all();

    res.json({ success: true, data: rows.map(parseProject) });
  } catch (err) { next(err); }
}

export function getProject(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, Number(req.params.id)))
      .get();

    if (!project) throw new AppError(404, '项目不存在');
    if (project.userId !== req.userId) throw new AppError(403, '无权访问');

    const files = db.select().from(schema.projectFiles)
      .where(eq(schema.projectFiles.projectId, project.id))
      .orderBy(desc(schema.projectFiles.createdAt))
      .all();

    const checkpoints = db.select().from(schema.checkpoints)
      .where(eq(schema.checkpoints.projectId, project.id))
      .all();

    const events = db.select().from(schema.jobEvents)
      .where(eq(schema.jobEvents.projectId, project.id))
      .orderBy(desc(schema.jobEvents.createdAt))
      .all();

    res.json({
      success: true,
      data: {
        ...parseProject(project),
        files: files.map(parseFile),
        checkpoints: checkpoints.map(parseCheckpoint),
        events: events.map(parseEvent).reverse(),
      },
    });
  } catch (err) { next(err); }
}

export function createProject(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createProjectSchema.parse(req.body);
    const row = db.insert(schema.projects).values({
      title: data.title,
      course: data.course,
      scope: data.scope || null,
      difficulty: JSON.stringify(data.difficulty),
      nSets: data.nSets,
      outputType: data.outputType,
      verifyMode: data.verifyMode,
      userId: req.userId!,
    }).returning().get();

    // Ensure project file directory
    const projectDir = getProjectDir(row.id);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    // Create initial checkpoints
    for (const step of ['blueprint', 'template', 'selection']) {
      db.insert(schema.checkpoints).values({
        projectId: row.id,
        step,
        status: 'pending',
      }).run();
    }

    saveToDisk();
    res.status(201).json({ success: true, data: parseProject(row) });
  } catch (err) { next(err); }
}

export function deleteProject(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, Number(req.params.id)))
      .get();

    if (!project) throw new AppError(404, '项目不存在');
    if (project.userId !== req.userId) throw new AppError(403, '无权访问');

    // Delete associated records (CASCADE should handle DB, but clean files)
    db.delete(schema.jobEvents).where(eq(schema.jobEvents.projectId, project.id)).run();
    db.delete(schema.checkpoints).where(eq(schema.checkpoints.projectId, project.id)).run();
    db.delete(schema.projectFiles).where(eq(schema.projectFiles.projectId, project.id)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run();

    saveToDisk();
    res.json({ success: true, message: '项目已删除' });
  } catch (err) { next(err); }
}

// ====== Checkpoints ======
export function updateCheckpoint(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { step } = req.params;
    const { action, notes } = checkpointActionSchema.parse(req.body);
    const projectId = Number(req.params.id);

    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    const checkpoint = db.select().from(schema.checkpoints)
      .where(eq(schema.checkpoints.projectId, projectId))
      .where(eq(schema.checkpoints.step, step))
      .get();

    if (!checkpoint) throw new AppError(404, '检查点不存在');

    db.update(schema.checkpoints)
      .set({
        status: action === 'approve' ? 'approved' : 'rejected',
        teacherNotes: notes || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.checkpoints.id, checkpoint.id))
      .run();

    addEvent(projectId, step, 'log',
      action === 'approve' ? `✅ 教师已确认 ${stepLabel(step)}` : `❌ 教师驳回 ${stepLabel(step)}${notes ? `：${notes}` : ''}`);

    saveToDisk();

    // If approved, continue workflow in background
    if (action === 'approve') {
      res.json({ success: true, data: { ...checkpoint, status: 'approved' } });
      // Continue workflow asynchronously (don't block response)
      continueWorkflow(projectId).catch((err) => {
        console.error('Continue workflow error:', err);
      });
      return;
    }

    res.json({ success: true, data: { ...checkpoint, status: 'rejected' } });
  } catch (err) { next(err); }
}

// ====== Start Workflow ======
export async function startProjectWorkflow(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.id);
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    res.json({ success: true, message: '工作流已启动' });

    // Run workflow asynchronously
    startWorkflow(projectId).catch((err) => {
      console.error('Workflow error:', err);
    });
  } catch (err) { next(err); }
}

// ====== SSE Stream ======
export function streamEvents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.id);

    // Verify access
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');

    // Register client
    if (!sseClients.has(projectId)) {
      sseClients.set(projectId, new Set());
    }
    sseClients.get(projectId)!.add(res);

    // Send existing events for catch-up
    const existingEvents = db.select().from(schema.jobEvents)
      .where(eq(schema.jobEvents.projectId, projectId))
      .orderBy(desc(schema.jobEvents.createdAt))
      .limit(50)
      .all();

    for (const evt of existingEvents.reverse()) {
      res.write(`data: ${JSON.stringify(parseEvent(evt))}\n\n`);
    }

    // Cleanup on disconnect
    req.on('close', () => {
      const clients = sseClients.get(projectId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) sseClients.delete(projectId);
      }
    });
  } catch (err) { next(err); }
}

// ====== Helpers ======
export function getProjectDir(projectId: number): string {
  const projectDir = join(process.cwd(), 'data', 'projects', String(projectId));
  return projectDir;
}

function stepLabel(step: string): string {
  const map: Record<string, string> = { blueprint: '双向细目表', template: '试卷模板', selection: '选卷' };
  return map[step] || step;
}

// Parse JSON fields from DB rows
function parseProject(row: typeof schema.projects.$inferSelect) {
  return {
    ...row,
    difficulty: JSON.parse(row.difficulty as string),
  };
}

function parseFile(row: typeof schema.projectFiles.$inferSelect) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  };
}

function parseCheckpoint(row: typeof schema.checkpoints.$inferSelect) {
  return row;
}

function parseEvent(row: typeof schema.jobEvents.$inferSelect) {
  return {
    ...row,
    data: row.data ? JSON.parse(row.data as string) : null,
  };
}
