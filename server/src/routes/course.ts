import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { archiveCourse, createCourse, getCourse, listCourses, updateCourse } from '../controllers/course.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listCourses);
router.post('/', createCourse);
router.get('/:id', getCourse);
router.patch('/:id', updateCourse);
router.delete('/:id', archiveCourse);

export default router;
