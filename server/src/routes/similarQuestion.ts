import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createSimilarQuestionJob,
  getSimilarQuestionJob,
  listSimilarQuestionJobs,
  retrySimilarQuestionJobController,
  saveSimilarQuestionResults,
} from '../controllers/similarQuestion.js';
import { aiGenerationRateLimit } from '../middleware/rateLimit.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listSimilarQuestionJobs);
router.post('/', aiGenerationRateLimit, createSimilarQuestionJob);
router.get('/:id', getSimilarQuestionJob);
router.post('/:id/retry', aiGenerationRateLimit, retrySimilarQuestionJobController);
router.post('/:id/save', saveSimilarQuestionResults);

export default router;
