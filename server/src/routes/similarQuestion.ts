import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createSimilarQuestionJob,
  getSimilarQuestionJob,
  listSimilarQuestionJobs,
  retrySimilarQuestionJobController,
  saveSimilarQuestionResults,
} from '../controllers/similarQuestion.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listSimilarQuestionJobs);
router.post('/', createSimilarQuestionJob);
router.get('/:id', getSimilarQuestionJob);
router.post('/:id/retry', retrySimilarQuestionJobController);
router.post('/:id/save', saveSimilarQuestionResults);

export default router;
