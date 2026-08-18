import type { DifficultyLevel, PaperStatus, QuestionStatus, QuestionType } from '@exam-maker/shared';

export const questionTypeLabels: Record<QuestionType, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  short_answer: '简答题',
  calculation: '计算题',
  essay: '论述题',
};

export const difficultyLabels: Record<DifficultyLevel, string> = {
  basic: '基础',
  medium: '中等',
  hard: '困难',
};

export const questionStatusLabels: Record<QuestionStatus, string> = {
  generated: '待审核',
  reviewed: '已审核',
  rejected: '已拒绝',
};

export const questionStatusColors: Record<QuestionStatus, string> = {
  generated: 'processing',
  reviewed: 'success',
  rejected: 'error',
};

export const paperStatusLabels: Record<PaperStatus, string> = {
  draft: '草稿',
  ready: '已就绪',
  archived: '已归档',
};
