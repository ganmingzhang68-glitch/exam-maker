import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { eq } from 'drizzle-orm';
import { db, schema, saveToDisk } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { addEvent } from './project.js';
import { getProjectDir } from '../services/workflow.js';
import { closeSync, existsSync, mkdirSync, openSync, readSync, unlinkSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';

// Configure multer for past paper uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const req = _req as AuthRequest;
    const projectId = Number(req.params.id);
    const dir = join(getProjectDir(projectId), 'past_papers');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // Keep original filename, add timestamp to avoid conflicts.
    // Sanitize to ASCII-safe to avoid Windows unicode path issues.
    const ext = extname(file.originalname);
    const base = file.originalname.slice(0, -ext.length);
    // Replace non-ASCII chars with a safe token, keep extension
    const safeBase = base.replace(/[^\x20-\x7E]/g, '_').replace(/[\\/:*?"<>|]/g, '_');
    const safeName = safeBase.length > 0 ? safeBase : `paper_${Date.now()}`;
    cb(null, `${safeName}_${Date.now()}${ext.toLowerCase()}`);
  },
});

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/x-tex',
  'text/markdown',
  'text/plain',
];

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype) ||
        file.originalname.match(/\.(pdf|docx?|tex|md|txt)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，请上传 pdf/docx/doc/tex/md/txt 文件'));
    }
  },
});

export const uploadPastPapers = upload.array('files', 20); // max 20 files

export function authorizeProjectUpload(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError(400, '项目 ID 无效');
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!project || (req.userRole !== 'admin' && project.userId !== req.userId)) throw new AppError(403, '无权上传到该项目');
    next();
  } catch (error) { next(error); }
}

function hasValidSignature(file: Express.Multer.File): boolean {
  const extension = extname(file.originalname).toLowerCase(); const descriptor = openSync(file.path, 'r'); const bytes = Buffer.alloc(4096);
  let length = 0; try { length = readSync(descriptor, bytes, 0, bytes.length, 0); } finally { closeSync(descriptor); }
  const head = bytes.subarray(0, length);
  if (extension === '.pdf') return head.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.docx') return head[0] === 0x50 && head[1] === 0x4b;
  if (extension === '.doc') return head.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  return !head.includes(0);
}

export async function handleUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.id);

    // Verify project ownership
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) throw new AppError(400, '请选择文件');
    const projectRoot = `${resolve(getProjectDir(projectId), 'past_papers')}${sep}`;
    const invalid = files.find(file => !resolve(file.path).startsWith(projectRoot) || !hasValidSignature(file));
    if (invalid) {
      files.forEach(file => { const path = resolve(file.path); if (path.startsWith(projectRoot) && existsSync(path)) unlinkSync(path); });
      throw new AppError(400, `文件内容与格式不匹配：${invalid.originalname}`);
    }

    const results = [];
    for (const file of files) {
      const row = db.insert(schema.projectFiles).values({
        projectId,
        type: 'past_paper',
        filename: file.originalname,
        filepath: file.path,
        metadata: JSON.stringify({
          size: file.size,
          mimetype: file.mimetype,
          storedName: file.filename,
        }),
      }).returning().get();
      results.push(row);
    }

    // Update project status to parsing
    db.update(schema.projects)
      .set({ status: 'parsing', updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId)).run();

    addEvent(projectId, 'upload', 'log', `📤 已上传 ${files.length} 份真题文件`, {
      files: files.map(f => f.originalname),
    });

    saveToDisk();
    res.status(201).json({ success: true, data: results });
  } catch (err) { next(err); }
}

export function getFile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const fileId = Number(req.params.fileId);
    const file = db.select().from(schema.projectFiles)
      .where(eq(schema.projectFiles.id, fileId)).get();

    if (!file) throw new AppError(404, '文件不存在');

    // Verify project ownership
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, file.projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    // If downloading
    if (req.query.download === '1') {
      return res.download(file.filepath, file.filename);
    }

    // Otherwise send file for preview
    res.sendFile(file.filepath, { root: process.cwd() });
  } catch (err) { next(err); }
}

export function downloadFile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const fileId = Number(req.params.fileId);
    const file = db.select().from(schema.projectFiles)
      .where(eq(schema.projectFiles.id, fileId)).get();

    if (!file) throw new AppError(404, '文件不存在');

    // Verify project ownership
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, file.projectId)).get();
    if (!project || project.userId !== req.userId) throw new AppError(403, '无权访问');

    res.download(file.filepath, file.filename);
  } catch (err) { next(err); }
}
