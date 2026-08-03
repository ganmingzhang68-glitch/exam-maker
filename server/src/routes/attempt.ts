import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getAttempt, saveAttemptAnswer, submitAttempt } from '../controllers/attempt.js';

const router = Router();
router.use(requireAuth, requireRole('student'));
router.get('/:id', getAttempt);
router.put('/:id/answers/:paperQuestionId', saveAttemptAnswer);
router.post('/:id/submit', submitAttempt);

export default router;
