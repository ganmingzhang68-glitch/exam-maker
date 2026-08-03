import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getStudentExamQuestions } from '../controllers/exam.js';

const router = Router();
router.get('/:id/questions', requireAuth, requireRole('student'), getStudentExamQuestions);

export default router;
