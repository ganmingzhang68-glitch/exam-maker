import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listProjects, getProject, createProject, deleteProject,
  updateCheckpoint, startProjectWorkflow, streamEvents,
} from '../controllers/project.js';
import { uploadPastPapers, handleUpload, getFile, downloadFile } from '../controllers/upload.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// Project CRUD
router.get('/', listProjects);
router.post('/', createProject);
router.get('/:id', getProject);
router.delete('/:id', deleteProject);

// Start workflow
router.post('/:id/start', startProjectWorkflow);

// File upload & download
router.post('/:id/upload', uploadPastPapers, handleUpload);
router.get('/:id/files/:fileId', getFile);
router.get('/:id/download/:fileId', downloadFile);

// Checkpoints
router.post('/:id/checkpoints/:step', updateCheckpoint);

// SSE events stream
router.get('/:id/events', streamEvents);

export default router;
