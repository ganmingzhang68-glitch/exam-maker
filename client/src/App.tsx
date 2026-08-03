import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
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
import NotFound from './pages/NotFound';

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
          <ProtectedRoute allowedRoles={['teacher', 'admin']}>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/new" element={<ProjectNew />} />
        <Route path="/projects/:id" element={<ProjectWorkspace />} />
        <Route path="/questions" element={<QuestionBank />} />
        <Route path="/questions/review" element={<QuestionBank reviewMode />} />
        <Route path="/questions/:id/edit" element={<QuestionEdit />} />
        <Route path="/papers" element={<PaperList />} />
        <Route path="/papers/:id" element={<PaperEdit />} />
      </Route>

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default App;
