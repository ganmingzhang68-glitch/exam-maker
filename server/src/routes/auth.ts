import { Router } from 'express';
import { register, login, getMe } from '../controllers/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rateLimit.js';

const router = Router();

router.post('/register', register);
router.post('/login', loginRateLimit, login);
router.get('/me', requireAuth, getMe);

export default router;
