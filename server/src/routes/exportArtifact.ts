import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { downloadExportArtifact } from '../controllers/exportArtifact.js';

const router = Router();
router.use(requireAuth);
router.get('/:artifactId/download', downloadExportArtifact);
export default router;
