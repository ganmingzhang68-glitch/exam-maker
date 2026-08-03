// ============ User ============
export type UserRole = 'teacher' | 'student' | 'admin';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

// ============ Project ============
export type ProjectStatus =
  | 'drafting'      // 步骤0: 参数配置中
  | 'parsing'       // 步骤1: 真题解析为 LaTeX
  | 'blueprinting'  // 步骤2: 等待教师确认细目表
  | 'templating'    // 步骤3: 等待教师确认模板
  | 'assigning'     // 步骤4: 自动分配难度
  | 'generating'    // 步骤5: 生成 N 套新卷
  | 'compiling'     // 步骤6: 编译/转换
  | 'done'          // 完成，等待选卷
  | 'error';        // 出错

export interface DifficultyRatio {
  basic: number;     // e.g. 60
  medium: number;    // e.g. 30
  hard: number;      // e.g. 10
}

export interface Project {
  id: number;
  title: string;
  course: string;
  scope: string | null;
  difficulty: DifficultyRatio;
  nSets: number;
  outputType: 'latex' | 'docx' | 'md';
  verifyMode: 'auto' | 'computational' | 'conceptual' | 'mixed';
  status: ProjectStatus;
  userId: number;
  createdAt: string;
  updatedAt: string;
}

// ============ Project File ============
export type FileType =
  | 'past_paper'
  | 'source_tex'
  | 'blueprint'
  | 'template'
  | 'generated_paper'
  | 'final_output'
  | 'env_report';

export interface ProjectFile {
  id: number;
  projectId: number;
  type: FileType;
  filename: string;
  filepath: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ============ Checkpoint ============
export type CheckpointStep = 'blueprint' | 'template' | 'selection';
export type CheckpointStatus = 'pending' | 'approved' | 'rejected';

export interface Checkpoint {
  id: number;
  projectId: number;
  step: CheckpointStep;
  status: CheckpointStatus;
  teacherNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============ Job Event ============
export type EventType = 'log' | 'progress' | 'error' | 'done';

export interface JobEvent {
  id: number;
  projectId: number;
  step: string;
  eventType: EventType;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

// ============ API Response ============
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// ============ Auth ============
export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ============ Project DTOs ============
export interface CreateProjectRequest {
  title: string;
  course: string;
  scope?: string;
  difficulty?: DifficultyRatio;
  nSets?: number;
  outputType?: 'latex' | 'docx' | 'md';
  verifyMode?: 'auto' | 'computational' | 'conceptual' | 'mixed';
}

export interface ProjectDetail extends Project {
  files: ProjectFile[];
  checkpoints: Checkpoint[];
  events: JobEvent[];
}

// ============ Exam MVP foundation ============
export type QuestionStatus = 'generated' | 'reviewed' | 'rejected';
export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'calculation'
  | 'essay';
export type DifficultyLevel = 'basic' | 'medium' | 'hard';

export interface Question {
  id: number;
  createdBy: number;
  sourceFileId: number | null;
  sourceProjectId: number | null;
  sourceQuestionNo: string | null;
  type: QuestionType;
  stem: string;
  options: string[] | null;
  answerKey: Record<string, unknown> | null;
  analysis: string | null;
  scoringRubric: Record<string, unknown> | null;
  defaultScore: number;
  difficulty: DifficultyLevel | null;
  knowledgePoints: string[] | null;
  status: QuestionStatus;
  aiGenerated: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type PaperStatus = 'draft' | 'ready' | 'archived';
export interface Paper {
  id: number;
  createdBy: number;
  sourceProjectId: number | null;
  title: string;
  course: string;
  description: string | null;
  instructions: string | null;
  durationMinutes: number;
  totalScore: number;
  status: PaperStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaperQuestion {
  id: number;
  paperId: number;
  questionId: number;
  sectionTitle: string | null;
  orderNo: number;
  score: number;
  questionSnapshot: Record<string, unknown> | null;
  createdAt: string;
}

export type ExamStatus = 'draft' | 'published' | 'closed';
export interface Exam {
  id: number;
  paperId: number;
  createdBy: number;
  title: string;
  status: ExamStatus;
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExamAssignment {
  id: number;
  examId: number;
  studentId: number;
  assignedAt: string;
  dueAt: string | null;
}

export type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'grading' | 'graded';
export interface Attempt {
  id: number;
  examId: number;
  assignmentId: number;
  studentId: number;
  attemptNo: number;
  status: AttemptStatus;
  startedAt: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  objectiveScore: number;
  subjectiveScore: number;
  totalScore: number;
  gradedBy: number | null;
  gradedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AnswerGradingStatus = 'ungraded' | 'auto_graded' | 'manual_graded';
export interface Answer {
  id: number;
  attemptId: number;
  paperQuestionId: number;
  content: Record<string, unknown> | null;
  autoScore: number | null;
  manualScore: number | null;
  finalScore: number | null;
  isCorrect: boolean | null;
  gradingStatus: AnswerGradingStatus;
  feedback: string | null;
  gradedBy: number | null;
  gradedAt: string | null;
  savedAt: string;
  createdAt: string;
  updatedAt: string;
}
