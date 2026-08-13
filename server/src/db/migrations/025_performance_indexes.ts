import type { Database } from 'sql.js';
export const performanceIndexesMigration = { id: '025_performance_indexes', up(database: Database): void {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS attempts_exam_student_status_idx ON attempts(exam_id, student_id, status, updated_at)',
    'CREATE INDEX IF NOT EXISTS attempts_student_status_idx ON attempts(student_id, status, updated_at)',
    'CREATE INDEX IF NOT EXISTS answers_attempt_grading_idx ON answers(attempt_id, grading_status)',
    'CREATE INDEX IF NOT EXISTS exam_assignments_student_due_idx ON exam_assignments(student_id, due_at)',
    'CREATE INDEX IF NOT EXISTS questions_course_lifecycle_idx ON questions(course_id, lifecycle_status, updated_at)',
    'CREATE INDEX IF NOT EXISTS question_quality_exam_review_idx ON question_quality_reports(exam_id, review_status, updated_at)',
    'CREATE INDEX IF NOT EXISTS ai_runs_status_created_idx ON ai_runs(status, created_at)',
    'CREATE INDEX IF NOT EXISTS ai_runs_model_created_idx ON ai_runs(provider, model, created_at)',
    'CREATE INDEX IF NOT EXISTS generation_jobs_task_created_idx ON generation_jobs(task_status, created_at)',
    'CREATE INDEX IF NOT EXISTS similar_jobs_task_created_idx ON similar_question_jobs(task_status, created_at)',
    'CREATE INDEX IF NOT EXISTS job_events_project_created_idx ON job_events(project_id, created_at)',
  ];
  indexes.forEach(statement => database.run(statement));
} };
