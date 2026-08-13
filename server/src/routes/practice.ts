import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { answer, create, detail, list, options } from '../controllers/practice.js';

const router = Router();
router.use(requireAuth, requireRole('student'));
router.get('/options', options);
router.get('/sessions', list);
router.post('/sessions', create);
router.get('/sessions/:id', detail);
router.put('/sessions/:id/items/:itemId', answer);
export default router;
