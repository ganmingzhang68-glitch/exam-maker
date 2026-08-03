import { Request, Response, NextFunction } from 'express';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema, rawDb, saveToDisk } from '../db/index.js';
import { createProjectSchema, checkpointActionSchema } from '@exam-maker/shared';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startWorkflow, continueWorkflow, getProjectDir } from '../services/workflow.js';
import { detectEnvironment, envReport } from '../services/envDetect.js';

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
      .where(and(
        eq(schema.checkpoints.projectId, projectId),
        eq(schema.checkpoints.step, step),
      ))
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

// ====== Environment Detection ======
export function getEnvironment(_req: AuthRequest, res: Response) {
  const env = detectEnvironment();
  res.json({ success: true, data: { env, report: envReport(env) } });
}

// ====== Blueprint Data ======
export function getBlueprint(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.id);
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    const jsonlPath = join(getProjectDir(projectId), 'blueprint.jsonl');
    const mdPath = join(getProjectDir(projectId), 'blueprint.md');

    if (!existsSync(jsonlPath)) {
      return res.json({ success: true, data: null });
    }

    const jsonlContent = readFileSync(jsonlPath, 'utf-8');
    const entries = jsonlContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    let mdContent = '';
    try { mdContent = readFileSync(mdPath, 'utf-8'); } catch { /* ignore */ }

    res.json({ success: true, data: { entries, markdown: mdContent } });
  } catch (err) { next(err); }
}

// ====== Template Data ======
export function getTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.id);
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    const jsonPath = join(getProjectDir(projectId), 'template.json');
    const mdPath = join(getProjectDir(projectId), 'template.md');
    const diffPath = join(getProjectDir(projectId), 'difficulty.json');

    if (!existsSync(jsonPath)) {
      return res.json({ success: true, data: null });
    }

    const jsonContent = readFileSync(jsonPath, 'utf-8');
    const template = JSON.parse(jsonContent);

    let mdContent = '';
    try { mdContent = readFileSync(mdPath, 'utf-8'); } catch { /* ignore */ }

    let difficulty = null;
    if (existsSync(diffPath)) {
      try { difficulty = JSON.parse(readFileSync(diffPath, 'utf-8')); } catch { /* ignore */ }
    }

    res.json({ success: true, data: { template, markdown: mdContent, difficulty } });
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
