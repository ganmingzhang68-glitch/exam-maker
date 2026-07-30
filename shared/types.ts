// ============ User ============
export type UserRole = 'teacher' | 'admin';

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
  | 'final_output';

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
