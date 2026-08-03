import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createQuestion, deleteQuestion, getQuestion, listQuestions, updateQuestion,
} from '../controllers/question.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listQuestions);
router.post('/', createQuestion);
router.get('/:id', getQuestion);
router.patch('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

export default router;
