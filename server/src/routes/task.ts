import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { cancelTaskController, getTaskController, listTaskController, retryTaskController } from '../controllers/task.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listTaskController);
router.get('/:kind/:id', getTaskController);
router.post('/:kind/:id/cancel', cancelTaskController);
router.post('/:kind/:id/retry', retryTaskController);
export default router;
