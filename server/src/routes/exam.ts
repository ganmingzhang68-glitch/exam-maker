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
import {
  getTeacherAttemptResult,
  gradeSubjectiveAnswer,
  listExamResults,
} from '../controllers/result.js';
import { getExamAssessment, reviewExamQuestionQuality } from '../controllers/assessment.js';

const router = Router();

router.get('/mine', requireAuth, requireRole('student'), listStudentExams);
router.post('/:id/start', requireAuth, requireRole('student'), startExam);
router.get('/:id/questions', requireAuth, requireRole('student'), getStudentExamQuestions);

router.get('/', requireAuth, requireRole('teacher', 'admin'), listTeacherExams);
router.post('/', requireAuth, requireRole('teacher', 'admin'), createExam);
router.get('/:id/results', requireAuth, requireRole('teacher', 'admin'), listExamResults);
router.get('/:id/quality', requireAuth, requireRole('teacher', 'admin'), getExamAssessment);
router.post('/:id/quality/questions/:paperQuestionId/review', requireAuth, requireRole('teacher', 'admin'), reviewExamQuestionQuality);
router.get('/:id/attempts/:attemptId', requireAuth, requireRole('teacher', 'admin'), getTeacherAttemptResult);
router.patch(
  '/:id/attempts/:attemptId/answers/:answerId/grade',
  requireAuth,
  requireRole('teacher', 'admin'),
  gradeSubjectiveAnswer,
);
router.get('/:id', requireAuth, requireRole('teacher', 'admin'), getTeacherExam);
router.patch('/:id', requireAuth, requireRole('teacher', 'admin'), updateExam);
router.post('/:id/publish', requireAuth, requireRole('teacher', 'admin'), publishExam);
router.post('/:id/close', requireAuth, requireRole('teacher', 'admin'), closeExam);

export default router;
