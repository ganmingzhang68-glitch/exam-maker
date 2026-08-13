import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getCourseKnowledgeAnalytics, getMyLearning } from '../controllers/learning.js';

const router = Router();
router.get('/student', requireAuth, requireRole('student'), getMyLearning);
router.get('/courses/:id', requireAuth, requireRole('teacher', 'admin'), getCourseKnowledgeAnalytics);
export default router;
