import { Router } from 'express';
import { getStudentDashboard, getTeacherDashboard } from '../controllers/dashboard.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.get('/teacher', requireAuth, requireRole('teacher', 'admin'), getTeacherDashboard);
router.get('/student', requireAuth, requireRole('student'), getStudentDashboard);
export default router;
