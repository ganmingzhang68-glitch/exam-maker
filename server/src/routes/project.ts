import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listProjects, getProject, createProject, deleteProject,
  updateCheckpoint, startProjectWorkflow, getEnvironment, getBlueprint, getTemplate, streamEvents,
} from '../controllers/project.js';
import { authorizeProjectUpload, uploadPastPapers, handleUpload, getFile, downloadFile } from '../controllers/upload.js';
import { aiGenerationRateLimit, uploadRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// All routes require auth
router.use(requireAuth, requireRole('teacher', 'admin'));

// Environment detection (no project needed)
router.get('/env', getEnvironment);

// Project CRUD
router.get('/', listProjects);
router.post('/', createProject);
router.get('/:id', getProject);
router.delete('/:id', deleteProject);

// Start workflow
router.post('/:id/start', aiGenerationRateLimit, startProjectWorkflow);

// File upload & download
router.post('/:id/upload', uploadRateLimit, authorizeProjectUpload, uploadPastPapers, handleUpload);
router.get('/:id/files/:fileId', getFile);
router.get('/:id/download/:fileId', downloadFile);

// Blueprint data
router.get('/:id/blueprint', getBlueprint);

// Template data
router.get('/:id/template', getTemplate);

// Checkpoints
router.post('/:id/checkpoints/:step', updateCheckpoint);

// SSE events stream
router.get('/:id/events', streamEvents);

export default router;
