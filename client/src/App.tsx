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
import NotFound from './pages/NotFound';

const teacherRoles = ['teacher', 'admin'] as const;

const HomeRoute: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  if (user?.role === 'student') return <Navigate to="/student/exams" replace />;
  return <ProjectList />;
};

const TeacherRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute allowedRoles={[...teacherRoles]}>{children}</ProtectedRoute>
);

const StudentRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute allowedRoles={['student']}>{children}</ProtectedRoute>
);

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
        <Route path="/projects/new" element={<TeacherRoute><ProjectNew /></TeacherRoute>} />
        <Route path="/projects/:id" element={<TeacherRoute><ProjectWorkspace /></TeacherRoute>} />
        <Route path="/questions" element={<TeacherRoute><QuestionBank /></TeacherRoute>} />
        <Route path="/questions/review" element={<TeacherRoute><QuestionBank reviewMode /></TeacherRoute>} />
        <Route path="/questions/:id/edit" element={<TeacherRoute><QuestionEdit /></TeacherRoute>} />
        <Route path="/papers" element={<TeacherRoute><PaperList /></TeacherRoute>} />
        <Route path="/papers/:id" element={<TeacherRoute><PaperEdit /></TeacherRoute>} />
        <Route path="/exams" element={<TeacherRoute><ExamList /></TeacherRoute>} />
        <Route path="/student/exams" element={<StudentRoute><StudentExamList /></StudentRoute>} />
        <Route path="/attempts/:id" element={<StudentRoute><ExamTaking /></StudentRoute>} />
      </Route>

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default App;
