import type { NextFunction, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export function downloadExportArtifact(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.artifactId);
    const artifact = db.select().from(schema.exportArtifacts).where(eq(schema.exportArtifacts.id, id)).get();
    if (!artifact) throw new AppError(404, '导出文件不存在');
    const paper = db.select().from(schema.generatedPapers).where(eq(schema.generatedPapers.id, artifact.generatedPaperId)).get();
    if (!paper) throw new AppError(404, '试卷不存在');
    if (req.userRole === 'student') {
      if (artifact.audience !== 'student' || !paper.selectedAt) throw new AppError(403, '学生无权访问该导出文件');
    } else if (req.userRole !== 'admin') {
      const job = paper.generationJobId ? db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, paper.generationJobId)).get() : null;
      if (!job || job.requestedBy !== req.userId) throw new AppError(403, '无权访问该导出文件');
    }
    const downloadName = `${paper.title}-${artifact.artifactType}.${artifact.format === 'markdown' ? 'md' : artifact.format === 'latex' ? 'tex' : artifact.format}`;
    res.download(artifact.storagePath, downloadName);
  } catch (error) { next(error); }
}
