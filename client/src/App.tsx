import React, { useEffect } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import AppLayout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ProjectList from './pages/ProjectList';
import ProjectNew from './pages/ProjectNew';
import ProjectWorkspace from './pages/ProjectWorkspace';
import QuestionBank from './pages/QuestionBank';
import QuestionEdit from './pages/QuestionEdit';
import PaperList from './pages/PaperList';
import PaperEdit from './pages/PaperEdit';
import ExamList from './pages/ExamList';
import StudentExamList from './pages/StudentExamList';
import ExamTaking from './pages/ExamTaking';
import ExamResults from './pages/ExamResults';
import AttemptGrading from './pages/AttemptGrading';
import StudentResult from './pages/StudentResult';
import NotFound from './pages/NotFound';
import SimilarQuestionGenerator from './pages/SimilarQuestionGenerator';
import CourseList from './pages/CourseList';
import CourseDetail from './pages/CourseDetail';
import TeachingClassList from './pages/TeachingClassList';
import TeachingClassDetail from './pages/TeachingClassDetail';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDashboard from './pages/StudentDashboard';
import QuestionDetail from './pages/QuestionDetail';
import TaskCenter from './pages/TaskCenter';
import StudentLearning from './pages/StudentLearning';
import TeacherKnowledgeAnalytics from './pages/TeacherKnowledgeAnalytics';
import StudentPractice from './pages/StudentPractice';
import StudentPracticeSession from './pages/StudentPracticeSession';
import TeachingAnalytics from './pages/TeachingAnalytics';
import StudentGradeReviews from './pages/StudentGradeReviews';
import TeacherGradeReviews from './pages/TeacherGradeReviews';
import AdminConsole from './pages/AdminConsole';

const teacherRoles = ['teacher', 'admin'] as const;

const HomeRoute: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  if (user?.role === 'student') return <Navigate to="/student/dashboard" replace />;
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  return <TeacherDashboard />;
};

const TeacherRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute allowedRoles={[...teacherRoles]}>{children}</ProtectedRoute>
);

const StudentRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute allowedRoles={['student']}>{children}</ProtectedRoute>
);
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => <ProtectedRoute allowedRoles={['admin']}>{children}</ProtectedRoute>;

const App: React.FC = () => {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Protected — with sidebar layout */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomeRoute />} />
        <Route path="/admin" element={<AdminRoute><AdminConsole /></AdminRoute>} />
        <Route path="/projects" element={<TeacherRoute><ProjectList /></TeacherRoute>} />
        <Route path="/projects/new" element={<TeacherRoute><ProjectNew /></TeacherRoute>} />
        <Route path="/courses" element={<TeacherRoute><CourseList /></TeacherRoute>} />
        <Route path="/courses/:id" element={<TeacherRoute><CourseDetail /></TeacherRoute>} />
        <Route path="/classes" element={<TeacherRoute><TeachingClassList /></TeacherRoute>} />
        <Route path="/classes/:id" element={<TeacherRoute><TeachingClassDetail /></TeacherRoute>} />
        <Route path="/projects/:id" element={<TeacherRoute><ProjectWorkspace /></TeacherRoute>} />
        <Route path="/questions" element={<TeacherRoute><QuestionBank /></TeacherRoute>} />
        <Route path="/questions/generate" element={<TeacherRoute><SimilarQuestionGenerator /></TeacherRoute>} />
        <Route path="/questions/review" element={<TeacherRoute><QuestionBank reviewMode /></TeacherRoute>} />
        <Route path="/questions/:id/edit" element={<TeacherRoute><QuestionEdit /></TeacherRoute>} />
        <Route path="/questions/:id" element={<TeacherRoute><QuestionDetail /></TeacherRoute>} />
        <Route path="/papers" element={<TeacherRoute><PaperList /></TeacherRoute>} />
        <Route path="/papers/:id" element={<TeacherRoute><PaperEdit /></TeacherRoute>} />
        <Route path="/exams" element={<TeacherRoute><ExamList /></TeacherRoute>} />
        <Route path="/exams/:id/results" element={<TeacherRoute><ExamResults /></TeacherRoute>} />
        <Route path="/exams/:id/attempts/:attemptId/grade" element={<TeacherRoute><AttemptGrading /></TeacherRoute>} />
        <Route path="/teacher/tasks" element={<TeacherRoute><TaskCenter /></TeacherRoute>} />
        <Route path="/teacher/grade-reviews" element={<TeacherRoute><TeacherGradeReviews /></TeacherRoute>} />
        <Route path="/teacher/courses/:id/analytics/knowledge" element={<TeacherRoute><TeacherKnowledgeAnalytics /></TeacherRoute>} />
        <Route path="/teacher/courses/:id/analytics" element={<TeacherRoute><TeachingAnalytics /></TeacherRoute>} />
        <Route path="/student/exams" element={<StudentRoute><StudentExamList /></StudentRoute>} />
        <Route path="/student/dashboard" element={<StudentRoute><StudentDashboard /></StudentRoute>} />
        <Route path="/student/learning" element={<StudentRoute><StudentLearning /></StudentRoute>} />
        <Route path="/student/practice" element={<StudentRoute><StudentPractice /></StudentRoute>} />
        <Route path="/student/practice/:id" element={<StudentRoute><StudentPracticeSession /></StudentRoute>} />
        <Route path="/student/grade-reviews" element={<StudentRoute><StudentGradeReviews /></StudentRoute>} />
        <Route path="/attempts/:id" element={<StudentRoute><ExamTaking /></StudentRoute>} />
        <Route path="/attempts/:id/result" element={<StudentRoute><StudentResult /></StudentRoute>} />
      </Route>

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default App;
