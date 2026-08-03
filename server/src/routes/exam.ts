import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  closeExam,
  createExam,
  getStudentExamQuestions,
  getTeacherExam,
  listStudentExams,
  listTeacherExams,
  publishExam,
  startExam,
  updateExam,
} from '../controllers/exam.js';

const router = Router();

router.get('/mine', requireAuth, requireRole('student'), listStudentExams);
router.post('/:id/start', requireAuth, requireRole('student'), startExam);
router.get('/:id/questions', requireAuth, requireRole('student'), getStudentExamQuestions);

router.get('/', requireAuth, requireRole('teacher', 'admin'), listTeacherExams);
router.post('/', requireAuth, requireRole('teacher', 'admin'), createExam);
router.get('/:id', requireAuth, requireRole('teacher', 'admin'), getTeacherExam);
router.patch('/:id', requireAuth, requireRole('teacher', 'admin'), updateExam);
router.post('/:id/publish', requireAuth, requireRole('teacher', 'admin'), publishExam);
router.post('/:id/close', requireAuth, requireRole('teacher', 'admin'), closeExam);

export default router;
