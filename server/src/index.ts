import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env'), override: true });
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/project.js';
import questionRoutes from './routes/question.js';
import examRoutes from './routes/exam.js';
import paperRoutes from './routes/paper.js';
import attemptRoutes from './routes/attempt.js';
import exportArtifactRoutes from './routes/exportArtifact.js';
import similarQuestionRoutes from './routes/similarQuestion.js';
import courseRoutes from './routes/course.js';
import { resumeSimilarQuestionJobs } from './services/similarQuestionPipeline.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Global middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(authMiddleware);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/papers', paperRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/export-artifacts', exportArtifactRoutes);
app.use('/api/similar-question-jobs', similarQuestionRoutes);
app.use('/api/courses', courseRoutes);

// Error handler (must be last)
app.use(errorHandler);

async function start() {
  await initDb();
  runMigrations();
  resumeSimilarQuestionJobs();

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
