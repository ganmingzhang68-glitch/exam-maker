import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  addPaperQuestion,
  createPaper,
  copyPaper,
  deletePaper,
  getPaper,
  listPapers,
  removePaperQuestion,
  reorderPaperQuestions,
  updatePaper,
  updatePaperQuestion,
} from '../controllers/paper.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));

router.get('/', listPapers);
router.post('/', createPaper);
router.post('/:id/copy', copyPaper);
router.get('/:id', getPaper);
router.patch('/:id', updatePaper);
router.delete('/:id', deletePaper);
router.post('/:id/questions', addPaperQuestion);
router.patch('/:id/questions/reorder', reorderPaperQuestions);
router.patch('/:id/questions/:paperQuestionId', updatePaperQuestion);
router.delete('/:id/questions/:paperQuestionId', removePaperQuestion);

export default router;
