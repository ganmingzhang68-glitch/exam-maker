import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  addEnrollments, archiveTeachingClass, createTeachingClass, getTeachingClass,
  importEnrollments, listTeachingClasses, removeEnrollment, searchStudents, updateTeachingClass,
} from '../controllers/teachingClass.js';

const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));
router.get('/', listTeachingClasses);
router.post('/', createTeachingClass);
router.get('/:id/students/search', searchStudents);
router.post('/:id/enrollments/import', importEnrollments);
router.post('/:id/enrollments', addEnrollments);
router.delete('/:id/enrollments/:studentId', removeEnrollment);
router.get('/:id', getTeachingClass);
router.patch('/:id', updateTeachingClass);
router.delete('/:id', archiveTeachingClass);

export default router;
