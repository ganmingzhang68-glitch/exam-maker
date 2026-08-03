import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createQuestion, deleteQuestion, getQuestion, listQuestionSources, listQuestions,
  reviewQuestion, updateQuestion,
} from '../controllers/question.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listQuestions);
router.post('/', createQuestion);
router.get('/sources', listQuestionSources);
router.get('/:id', getQuestion);
router.patch('/:id', updateQuestion);
router.patch('/:id/review', reviewQuestion);
router.delete('/:id', deleteQuestion);

export default router;
