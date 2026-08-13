import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { downloadExportArtifact } from '../controllers/exportArtifact.js';
import { exportRateLimit } from '../middleware/rateLimit.js';

const router = Router();
router.use(requireAuth);
router.get('/:artifactId/download', exportRateLimit, downloadExportArtifact);
export default router;
