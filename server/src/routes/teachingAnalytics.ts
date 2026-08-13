import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getAnalytics, refreshAnalytics } from '../controllers/teachingAnalytics.js';
const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/courses/:id', getAnalytics);
router.post('/courses/:id/refresh', refreshAnalytics);
export default router;
