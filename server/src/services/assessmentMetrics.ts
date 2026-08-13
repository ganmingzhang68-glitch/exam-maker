import type { QuestionType } from '@exam-maker/shared';
import { assessmentConfig } from '../config/assessment.js';

export interface AssessmentItemInput {
  paperQuestionId: number;
  questionId: number;
  orderNo: number;
  stem: string;
  type: QuestionType;
  maxScore: number;
}

export interface AssessmentResponseInput {
  respondentId: number;
  totalScore: number;
  itemScores: Record<number, number>;
  itemCorrect: Record<number, boolean | null>;
}

export interface AssessmentInput {
  examId: number;
  paperTitle: string;
  totalScore: number;
  items: AssessmentItemInput[];
  responses: AssessmentResponseInput[];
}

export type MetricStatus = 'ok' | 'insufficient_sample' | 'not_applicable';

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values)!;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function standardDeviation(values: number[]): number | null {
  const value = variance(values);
  return value === null ? null : Math.sqrt(value);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const xMean = mean(xs)!;
  const yMean = mean(ys)!;
  let numerator = 0;
  let xSquares = 0;
  let ySquares = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] - xMean;
    const y = ys[i] - yMean;
    numerator += x * y;
    xSquares += x * x;
    ySquares += y * y;
  }
  const denominator = Math.sqrt(xSquares * ySquares);
  return denominator === 0 ? null : numerator / denominator;
}

function cronbachAlpha(itemScoreRows: number[][]): number | null {
  if (itemScoreRows.length < 2 || itemScoreRows[0]?.length < 2) return null;
  const itemCount = itemScoreRows[0].length;
  const itemVariances = Array.from({ length: itemCount }, (_, index) => variance(itemScoreRows.map(row => row[index])));
  const totalVariance = variance(itemScoreRows.map(row => row.reduce((sum, value) => sum + value, 0)));
  if (totalVariance === null || totalVariance === 0 || itemVariances.some(value => value === null)) return null;
  const varianceSum = itemVariances.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return itemCount / (itemCount - 1) * (1 - varianceSum / totalVariance);
}

const objectiveTypes: QuestionType[] = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank'];

export function calculateAssessmentMetrics(input: AssessmentInput) {
  const config = assessmentConfig;
  const sampleSize = input.responses.length;
  const sampleStatus: MetricStatus = sampleSize >= config.minimumSampleSize ? 'ok' : 'insufficient_sample';
  const totals = input.responses.map(response => response.totalScore);
  const groupSize = sampleSize ? Math.max(1, Math.floor(sampleSize * config.highLowGroupProportion)) : 0;
  const ranked = [...input.responses].sort((a, b) => b.totalScore - a.totalScore);
  const high = ranked.slice(0, groupSize);
  const low = ranked.slice(Math.max(groupSize, ranked.length - groupSize));

  const itemMetrics = input.items.map(item => {
    const scores = input.responses.map(response => response.itemScores[item.paperQuestionId] ?? 0);
    const scoreRates = scores.map(score => item.maxScore > 0 ? score / item.maxScore : 0);
    const objective = objectiveTypes.includes(item.type);
    const correctness = input.responses.map(response => response.itemCorrect[item.paperQuestionId]);
    const correctRate = objective && sampleSize
      ? correctness.filter(value => value === true).length / sampleSize : null;
    const highRate = objective && high.length
      ? high.filter(response => response.itemCorrect[item.paperQuestionId] === true).length / high.length : null;
    const lowRate = objective && low.length
      ? low.filter(response => response.itemCorrect[item.paperQuestionId] === true).length / low.length : null;
    const discrimination = sampleStatus === 'ok' && highRate !== null && lowRate !== null ? highRate - lowRate : null;
    const binary = correctness.map(value => value === true ? 1 : 0);
    const restScores = input.responses.map((response, index) => response.totalScore - scores[index]);
    const pointBiserial = objective && sampleStatus === 'ok' ? pearson(binary, restScores) : null;
    const flags: string[] = [];
    if (sampleStatus !== 'ok') flags.push('INSUFFICIENT_SAMPLE');
    if (sampleStatus === 'ok' && correctRate !== null && correctRate >= config.tooEasyCorrectRate) flags.push('TOO_EASY');
    if (sampleStatus === 'ok' && correctRate !== null && correctRate <= config.tooHardCorrectRate) flags.push('TOO_HARD');
    if (sampleStatus === 'ok' && discrimination !== null && discrimination < config.negativeDiscrimination) flags.push('NEGATIVE_DISCRIMINATION');
    else if (sampleStatus === 'ok' && discrimination !== null && discrimination < config.lowDiscrimination) flags.push('LOW_DISCRIMINATION');
    return {
      paperQuestionId: item.paperQuestionId, questionId: item.questionId, orderNo: item.orderNo,
      stem: item.stem, type: item.type, maxScore: item.maxScore, sampleSize,
      status: objective ? sampleStatus : sampleStatus === 'ok' ? 'not_applicable' as const : sampleStatus,
      correctRate: round(correctRate), empiricalDifficulty: round(correctRate === null ? null : 1 - correctRate),
      highGroupCorrectRate: round(sampleStatus === 'ok' ? highRate : null),
      lowGroupCorrectRate: round(sampleStatus === 'ok' ? lowRate : null),
      discriminationIndex: round(discrimination), pointBiserialCorrelation: round(pointBiserial),
      averageScoreRate: round(mean(scoreRates)), flags,
    };
  });
  const alpha = sampleStatus === 'ok'
    ? cronbachAlpha(input.responses.map(response => input.items.map(item => response.itemScores[item.paperQuestionId] ?? 0))) : null;
  const objectiveItems = itemMetrics.filter(item => item.correctRate !== null);
  const discriminatedItems = itemMetrics.filter(item => item.discriminationIndex !== null);
  return {
    examId: input.examId, paperTitle: input.paperTitle, sampleSize, sampleStatus,
    configuration: config,
    summary: {
      participantCount: sampleSize,
      meanScore: round(mean(totals)), standardDeviation: round(standardDeviation(totals)), medianScore: round(median(totals)),
      passingRate: round(sampleSize ? totals.filter(score => input.totalScore > 0 && score / input.totalScore >= config.passingScoreRate).length / sampleSize : null),
      totalScore: input.totalScore,
      cronbachAlpha: round(alpha),
      reliabilityStatus: sampleStatus !== 'ok' ? 'insufficient_sample' as const : alpha === null ? 'not_applicable' as const : 'ok' as const,
      averageCorrectRate: round(mean(objectiveItems.map(item => item.correctRate!))),
      averageEmpiricalDifficulty: round(mean(objectiveItems.map(item => item.empiricalDifficulty!))),
      averageDiscrimination: round(mean(discriminatedItems.map(item => item.discriminationIndex!))),
    },
    items: itemMetrics,
  };
}
