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
  | 'student_paper'
  | 'answer_key'
  | 'rubric'
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

// ============ Course management ============
export type CourseStatus = 'draft' | 'active' | 'archived';

export interface CourseRecord {
  id: number;
  ownerUserId: number;
  code: string | null;
  name: string;
  semester: string | null;
  description: string | null;
  instructorName: string | null;
  materialDocumentIds: number[];
  status: CourseStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseSummary {
  classCount: number;
  materialCount: number;
  questionCount: number;
  paperCount: number;
  examCount: number;
  gradedAttemptCount: number;
}

export interface CourseDetail extends CourseRecord {
  summary: CourseSummary;
}

export type TeachingClassStatus = 'active' | 'archived';
export type EnrollmentStatus = 'active' | 'removed';

export interface TeachingClass {
  id: number;
  courseId: number;
  teacherUserId: number;
  name: string;
  semester: string | null;
  status: TeachingClassStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  courseName: string;
  studentCount: number;
}

export interface EnrollmentStudent extends Pick<User, 'id' | 'username' | 'email'> {
  enrollmentId: number;
  enrollmentStatus: EnrollmentStatus;
  joinedAt: string;
  removedAt: string | null;
  examCount: number;
  completedExamCount: number;
}

export interface TeachingClassDetail extends TeachingClass {
  students: EnrollmentStudent[];
}

export interface StudentSearchResult extends Pick<User, 'id' | 'username' | 'email'> {
  enrollmentStatus: EnrollmentStatus | null;
}

export interface EnrollmentImportResult {
  added: number[];
  restored: number[];
  alreadyActive: number[];
  missing: string[];
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
  courseId: number | null;
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
  predictedDifficultyScore: number | null;
  teacherDifficultyScore: number | null;
  knowledgePoints: string[] | null;
  status: QuestionStatus;
  aiGenerated: boolean;
  origin: 'past_exam' | 'ai_generated' | 'teacher_created' | 'imported';
  lifecycleStatus: 'draft' | 'reviewed' | 'approved' | 'needs_review' | 'archived';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionListItem extends Question {
  sourceFileName: string | null;
  sourceProjectTitle: string | null;
  courseName: string | null;
  usageCount: number;
}

export interface QuestionVersion { id: number; questionId: number; versionNo: number; snapshot: Question; changedBy: number; changeNote: string | null; createdAt: string }
export interface QuestionDetail extends QuestionListItem {
  versions: QuestionVersion[];
  usedByPapers: Array<{ id: number; title: string; status: PaperStatus }>;
  statistics: { responseCount: number; correctRate: number | null; averageScoreRate: number | null } | null;
}

export interface QuestionSource {
  id: number;
  projectId: number;
  filename: string;
  projectTitle: string;
  questionCount: number;
}

// ============ Similar question generation ============
export type SimilarQuestionJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'saved';
export type TaskStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'cancelled' | 'blocked';
export type TaskKind = 'generation' | 'similar_question';

export interface TaskStageAttempt {
  id: number;
  stage: string;
  attemptNumber: number;
  status: string;
  retryable: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface TaskSummary {
  key: string;
  id: number;
  kind: TaskKind;
  name: string;
  course: string | null;
  status: TaskStatus;
  currentStage: string | null;
  completedStages: number;
  totalStages: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  requestId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
  resultPath: string | null;
}

export interface TaskDetail extends TaskSummary {
  attempts: TaskStageAttempt[];
  costNote: string;
}
export type SimilarQuestionDifficultyMode = 'same' | 'lower' | 'higher';

export interface SimilarQuestionStage {
  id: number;
  stage: string;
  attemptNo: number;
  status: 'running' | 'succeeded' | 'failed';
  errorMessage: string | null;
  retryable: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SimilarQuestionResultItem {
  generatedQuestionId: number;
  sourceQuestionNo: string;
  questionType: QuestionType;
  stem: Array<{ type: string; content: string; assetId?: number | null }>;
  options: Array<{ id: string; content: Array<{ type: string; content: string; assetId?: number | null }> }>;
  subquestions: Array<{ id: string; label: string | null; stem: Array<{ type: string; content: string }>; score: number }>;
  score: number;
  knowledgePoints: string[];
  cognitiveLevel: string;
  difficulty: Record<string, unknown>;
  answer: Record<string, unknown>;
  explanation: string[];
  rubric: { totalScore: number; items: Array<Record<string, unknown>>; generalRule: string | null };
  originality: { similarity: number; notes: string; variationAxis: string };
  validation: { passed: boolean; findings: Array<Record<string, unknown>> };
  savedQuestionId: number | null;
}

export interface SimilarQuestionJob {
  id: number;
  course: string;
  scope: string | null;
  sourceText: string;
  sourceAnswer: string | null;
  variantsPerQuestion: number;
  defaultScore: number;
  difficultyMode: SimilarQuestionDifficultyMode;
  status: SimilarQuestionJobStatus;
  taskStatus?: TaskStatus;
  requestId?: string | null;
  currentStage: string | null;
  lastSuccessfulStage: string | null;
  errorSummary: string | null;
  result: { sourceQuestions: Array<Record<string, unknown>>; items: SimilarQuestionResultItem[] } | null;
  stages: SimilarQuestionStage[];
  createdAt: string;
  updatedAt: string;
}

export type PaperStatus = 'draft' | 'ready' | 'archived';
export interface Paper {
  id: number;
  createdBy: number;
  courseId: number | null;
  sourceProjectId: number | null;
  title: string;
  course: string;
  description: string | null;
  instructions: string | null;
  durationMinutes: number;
  totalScore: number;
  status: PaperStatus;
  creationMethod: 'ai_generated' | 'manual' | 'imported';
  createdAt: string;
  updatedAt: string;
}

export interface PaperSummary extends Paper { questionCount: number; usageCount: number; estimatedDifficulty: DifficultyLevel | null; displayStatus: PaperStatus | 'used' }

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

export interface PaperQuestionDetail extends PaperQuestion {
  question: Question;
}

export interface PaperDetail extends Paper {
  questions: PaperQuestionDetail[];
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
  allowedAttempts: number;
  fillBlankIgnoreCase: boolean;
  showAnswers: boolean;
  showAnalysis: boolean;
  gradeReviewEnabled: boolean;
  gradeReviewDeadline: string | null;
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
  paperSnapshot: AttemptPaperSnapshot | null;
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
export type AnswerContent = string | string[] | Record<string, unknown>;
export interface Answer {
  id: number;
  attemptId: number;
  paperQuestionId: number;
  content: AnswerContent | null;
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

export interface AttemptQuestionSnapshot {
  paperQuestionId: number;
  questionId: number;
  orderNo: number;
  sectionTitle: string | null;
  score: number;
  type: QuestionType;
  stem: string;
  options: string[] | null;
}

export interface AttemptPaperSnapshot {
  paper: {
    id: number;
    title: string;
    course: string;
    instructions: string | null;
    totalScore: number;
  };
  questions: AttemptQuestionSnapshot[];
}

export type StudentExamAvailability = 'upcoming' | 'available' | 'ended' | 'completed';
export type StudentExamDisplayStatus = 'upcoming' | 'available' | 'in_progress' | 'submitted' | 'grading' | 'graded' | 'ended';
export interface StudentExamSummary {
  id: number;
  title: string;
  status: ExamStatus;
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number;
  allowedAttempts: number;
  paperTitle: string;
  totalScore: number;
  attemptCount: number;
  availability: StudentExamAvailability;
  displayStatus: StudentExamDisplayStatus;
  latestAttempt: Attempt | null;
}

export interface TeacherDashboardExam {
  id: number;
  title: string;
  course: string;
  classNames: string[];
  startAt: string | null;
  endAt: string | null;
  status: ExamStatus;
  submittedCount: number;
  assignmentCount: number;
  pendingGradingCount: number;
}

export interface TeacherDashboardData {
  metrics: {
    activeCourseCount: number;
    activeClassCount: number;
    ongoingExamCount: number;
    pendingGradingCount: number;
    weeklySubmissionCount: number;
  };
  recentExams: TeacherDashboardExam[];
  recentPapers: Array<Pick<Paper, 'id' | 'title' | 'course' | 'status' | 'updatedAt'>>;
  issues: Array<{ type: string; title: string; description: string; resourceId: number }>;
  activities: Array<{ type: string; title: string; occurredAt: string; resourceId: number }>;
}

export interface StudentDashboardData {
  exams: StudentExamSummary[];
  courses: Array<{ id: number; name: string; classId: number; className: string; semester: string | null }>;
  metrics: {
    pendingCount: number;
    inProgressCount: number;
    upcomingCount: number;
    completedCount: number;
  };
  recentScores: Array<{ examId: number; examTitle: string; attemptId: number; score: number; totalScore: number; gradedAt: string | null }>;
}

export interface TeacherExamSummary extends Exam {
  paperTitle: string;
  paperTotalScore: number;
  assignmentCount: number;
  attemptCount: number;
}

export interface AttemptDetail {
  attempt: Attempt;
  exam: {
    id: number;
    title: string;
    endAt: string | null;
    durationMinutes: number;
  };
  paper: AttemptPaperSnapshot['paper'];
  questions: AttemptQuestionSnapshot[];
  answers: Answer[];
}

export interface TeacherExamStudentResult {
  assignmentId: number;
  student: Pick<User, 'id' | 'username' | 'email'>;
  attempts: Attempt[];
}

export type AssessmentMetricStatus = 'ok' | 'insufficient_sample' | 'not_applicable';
export interface AssessmentItemMetric {
  paperQuestionId: number;
  questionId: number;
  orderNo: number;
  stem: string;
  type: QuestionType;
  maxScore: number;
  sampleSize: number;
  status: AssessmentMetricStatus;
  correctRate: number | null;
  empiricalDifficulty: number | null;
  highGroupCorrectRate: number | null;
  lowGroupCorrectRate: number | null;
  discriminationIndex: number | null;
  pointBiserialCorrelation: number | null;
  averageScoreRate: number | null;
  blankRate: number;
  optionStatistics: Array<{
    optionId: string;
    text: string;
    isCorrect: boolean;
    selectionRate: number | null;
    highGroupSelectionRate: number | null;
    lowGroupSelectionRate: number | null;
    status: 'effective' | 'weak' | 'unused' | 'suspicious';
  }>;
  flags: string[];
  reviewStatus: 'pending' | 'confirmed' | 'ignored' | 'needs_revision';
}

export interface ExamAssessment {
  examId: number;
  paperTitle: string;
  sampleSize: number;
  sampleStatus: 'ok' | 'insufficient_sample';
  configuration: {
    minimumSampleSize: number;
    highLowGroupProportion: number;
    passingScoreRate: number;
    tooEasyCorrectRate: number;
    tooHardCorrectRate: number;
    lowDiscrimination: number;
    negativeDiscrimination: number;
    weakDistractorRate: number;
    suspiciousHighGroupGap: number;
    highBlankRate: number;
  };
  summary: {
    participantCount: number;
    meanScore: number | null;
    standardDeviation: number | null;
    medianScore: number | null;
    passingRate: number | null;
    totalScore: number;
    cronbachAlpha: number | null;
    reliabilityStatus: AssessmentMetricStatus;
    averageCorrectRate: number | null;
    averageEmpiricalDifficulty: number | null;
    averageDiscrimination: number | null;
  };
  items: AssessmentItemMetric[];
}

export type DifficultyCalibrationLabel = 'ai_underestimated' | 'ai_overestimated' | 'aligned' | 'unavailable';
export interface DifficultyCalibrationRecord {
  id: number;
  questionId: number;
  questionQualityReportId: number;
  questionStem: string;
  predictedDifficulty: number | null;
  teacherDifficulty: number | null;
  empiricalDifficulty: number;
  sampleSize: number;
  predictionError: number | null;
  calibrationLabel: DifficultyCalibrationLabel;
  createdAt: string;
}

export interface CourseDifficultyCalibration {
  courseId: number;
  sampleSize: number;
  minimumSampleSize: number;
  status: 'available' | 'insufficient_sample';
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  computedAt: string;
  records: DifficultyCalibrationRecord[];
}

export interface GradingQuestionDetail extends AttemptQuestionSnapshot {
  answer: Answer;
  answerKey: Record<string, unknown> | null;
  analysis: string | null;
  scoringRubric: Record<string, unknown> | null;
  subjective: boolean;
  aiSuggestion: AiGradingSuggestion | null;
}

export interface AiGradingSuggestion {
  id: number;
  answerId: number;
  suggestedScore: number | null;
  maxScore: number;
  rubricItemScores: Array<{ rubricItemId: string; awardedScore: number; maxScore: number; evidenceSummary: string; matched: string[]; missing: string[] }>;
  reasoningSummary: string | null;
  missingPoints: string[];
  matchedPoints: string[];
  confidence: number | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'accepted' | 'modified' | 'superseded';
  provider: string | null;
  model: string | null;
  promptVersionId: number | null;
  aiRunId: number | null;
  errorMessage: string | null;
  teacherFinalScore: number | null;
  scoreDifference: number | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GradingCalibrationMetric {
  key: string;
  label: string;
  sampleSize: number;
  status: 'available' | 'insufficient_sample';
  mae: number | null;
  bias: number | null;
  acceptanceRate: number | null;
  modificationRate: number | null;
}

export interface CourseGradingCalibration extends GradingCalibrationMetric {
  courseId: number;
  minimumSampleSize: number;
  computedAt: string;
  byQuestionType: GradingCalibrationMetric[];
  byRubric: GradingCalibrationMetric[];
}

export type MasteryLevel = 'mastered' | 'good' | 'developing' | 'weak' | 'insufficient_data';
export interface StudentKnowledgeMastery {
  id: number;
  studentId: number;
  courseId: number;
  courseName: string;
  knowledgePointId: number;
  knowledgePointName: string;
  parentKnowledgePointId: number | null;
  scoreRate: number | null;
  recentScoreRate: number | null;
  questionCount: number;
  assessmentCount: number;
  masteryLevel: MasteryLevel;
  lastAssessedAt: string | null;
  timeSpentSeconds: null;
  calculationVersion: string;
}

export interface StudentLearningOverview {
  configuration: { minimumQuestions: number; halfLifeDays: number; recentDays: number };
  courses: Array<{ courseId: number; courseName: string; knowledgePoints: StudentKnowledgeMastery[] }>;
}

export interface TeacherKnowledgeAnalyticsItem {
  knowledgePointId: number;
  knowledgePointName: string;
  parentKnowledgePointId: number | null;
  averageScoreRate: number | null;
  studentCount: number;
  weakStudentCount: number;
  questionCount: number;
  status: 'available' | 'insufficient_data';
}

export interface TeacherCourseKnowledgeAnalytics {
  courseId: number;
  courseName: string;
  enrolledStudentCount: number;
  items: TeacherKnowledgeAnalyticsItem[];
}

export type PracticeMode = 'wrong_questions' | 'knowledge_point' | 'weak_points';
export type PracticeSessionStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface PracticePlan {
  id: number;
  sessionId: number;
  requestedDistribution: Record<string, unknown>;
  selectedDistribution: Record<string, unknown>;
  questionIds: number[];
  shortages: Array<{ code: string; message: string; missingCount: number }>;
  selectionVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeQuestion {
  id: number;
  questionId: number;
  orderNo: number;
  stem: string;
  type: QuestionType;
  options: string[] | null;
  difficulty: DifficultyLevel | null;
  maxScore: number;
  knowledgePointIds: number[];
  knowledgePointNames: string[];
  answerContent: AnswerContent | null;
  score: number | null;
  isCorrect: boolean | null;
  status: 'pending' | 'answered' | 'graded';
  analysis?: string | null;
  answerKey?: Record<string, unknown> | null;
}

export interface PracticeSession {
  id: number;
  studentId: number;
  courseId: number;
  courseName: string;
  mode: PracticeMode;
  knowledgePointId: number | null;
  requestedCount: number;
  selectedCount: number;
  shortageCount: number;
  difficulty: DifficultyLevel | null;
  status: PracticeSessionStatus;
  scoreEarned: number;
  scorePossible: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  plan?: PracticePlan;
  questions?: PracticeQuestion[];
}

export interface PracticeOptions {
  courses: Array<{ id: number; name: string; knowledgePoints: Array<{ id: number; name: string; parentId: number | null; masteryLevel: MasteryLevel | null }> }>;
}

export interface TeachingAttentionStudent {
  studentId: number;
  username: string;
  reasons: Array<'missed_submission' | 'score_decline' | 'persistent_weakness'>;
  evidence: { assignedExamCount: number; completedExamCount: number; latestScoreRate: number | null; previousScoreRate: number | null; weakKnowledgePointCount: number };
}

export interface TeachingAnalytics {
  id: number;
  courseId: number;
  courseName: string;
  generatedAt: string;
  calculationVersion: string;
  summary: {
    enrolledStudentCount: number;
    publishedExamCount: number;
    assignmentCount: number;
    gradedAttemptCount: number;
    participationRate: number | null;
    averageScoreRate: number | null;
    completedPracticeCount: number;
    averagePracticeScoreRate: number | null;
    lowQualityQuestionCount: number;
    pendingQuestionReviewCount: number;
    weakKnowledgePoints: Array<{ knowledgePointId: number; name: string; averageScoreRate: number | null; weakStudentCount: number }>;
  };
  attentionStudents: TeachingAttentionStudent[];
  rules: string[];
}

export interface GradeReview {
  id: number; examId: number; examTitle: string; attemptId: number; answerId: number | null; studentId: number; studentName: string;
  reason: string; evidence: string | null; status: 'pending' | 'accepted' | 'rejected' | 'cancelled'; resolution: string | null;
  resolvedBy: number | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
  answer?: { paperQuestionId: number; content: AnswerContent | null; finalScore: number | null; maxScore: number } | null;
  auditLogs?: Array<{ id: number; actorUserId: number; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string; createdAt: string }>;
}

export interface TeacherAttemptGradingDetail {
  attempt: Attempt;
  student: Pick<User, 'id' | 'username' | 'email'>;
  exam: Pick<Exam, 'id' | 'title' | 'status'>;
  paper: AttemptPaperSnapshot['paper'];
  questions: GradingQuestionDetail[];
}

export interface StudentResultQuestion extends AttemptQuestionSnapshot {
  answer: Answer;
  answerKey?: Record<string, unknown> | null;
  analysis?: string | null;
}

export interface StudentAttemptResult {
  attempt: Attempt;
  exam: Pick<Exam, 'id' | 'title' | 'status' | 'showAnswers' | 'showAnalysis' | 'gradeReviewEnabled' | 'gradeReviewDeadline'>;
  paper: AttemptPaperSnapshot['paper'];
  questions: StudentResultQuestion[];
}
