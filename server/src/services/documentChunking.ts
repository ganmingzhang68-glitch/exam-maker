import { createHash } from 'node:crypto';

export type ChunkStage = 'document_structure' | 'question_parsing' | 'answer_alignment' | 'taxonomy_generation' | 'classification' | 'template_extraction';
export interface DocumentPage { pageNumber: number; text: string }
export interface DocumentChunk {
  id: string;
  sourceDocumentId: number;
  order: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  contentHash: string;
  estimatedTokens: number;
  overlapFromPrevious: boolean;
}
export interface TokenBudget {
  modelContextTokens: number;
  promptTokens: number;
  outputTokens: number;
  safetyTokens: number;
  availableInputTokens: number;
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const remainder = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk / 1.5 + remainder / 4));
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function splitAtSemanticBoundaries(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  const flush = () => { const value = current.join('\n').trim(); if (value) blocks.push(value); current = []; };
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const questionStart = !fenced && /^\s*(?:第\s*[一二三四五六七八九十\d]+\s*[题部分]|\d+(?:[.、．]|\s+[（(]))/.test(line);
    const heading = !fenced && /^\s*#{1,6}\s+/.test(line);
    if ((questionStart || heading) && current.length) flush();
    current.push(line);
    if (!fenced && line.trim() === '' && current.some((item) => item.trim() !== '')) flush();
  }
  flush();
  return blocks;
}

export function buildDocumentChunks(sourceDocumentId: number, pages: DocumentPage[], options: { targetTokens?: number; overlapBlocks?: number } = {}): DocumentChunk[] {
  const targetTokens = options.targetTokens ?? 1600;
  const overlapBlocks = Math.max(0, options.overlapBlocks ?? 1);
  const semantic = pages.flatMap((page) => splitAtSemanticBoundaries(page.text).map((content) => ({ page: page.pageNumber, content })));
  const groups: Array<typeof semantic> = [];
  let current: typeof semantic = [];
  let tokens = 0;
  for (const block of semantic) {
    const blockTokens = estimateTokens(block.content);
    if (current.length && tokens + blockTokens > targetTokens) {
      groups.push(current);
      current = current.slice(-overlapBlocks);
      tokens = current.reduce((sum, item) => sum + estimateTokens(item.content), 0);
    }
    current.push(block);
    tokens += blockTokens;
  }
  if (current.length) groups.push(current);
  return groups.map((group, order) => {
    const content = group.map((item) => item.content).join('\n\n');
    const contentHash = digest(content);
    return {
      id: `doc-${sourceDocumentId}-${order}-${contentHash.slice(0, 12)}`,
      sourceDocumentId, order, pageStart: Math.min(...group.map((item) => item.page)),
      pageEnd: Math.max(...group.map((item) => item.page)), content, contentHash,
      estimatedTokens: estimateTokens(content), overlapFromPrevious: order > 0 && overlapBlocks > 0,
    };
  });
}

const stageReserve: Record<ChunkStage, { output: number; safety: number }> = {
  document_structure: { output: 1200, safety: 800 }, question_parsing: { output: 2400, safety: 1000 },
  answer_alignment: { output: 1800, safety: 900 }, taxonomy_generation: { output: 1800, safety: 900 },
  classification: { output: 1800, safety: 900 }, template_extraction: { output: 1400, safety: 800 },
};

export function tokenBudgetForStage(stage: ChunkStage, promptText: string, modelContextTokens = Number(process.env.AI_CONTEXT_TOKENS || 16384)): TokenBudget {
  const promptTokens = estimateTokens(promptText);
  const reserve = stageReserve[stage];
  return { modelContextTokens, promptTokens, outputTokens: reserve.output, safetyTokens: reserve.safety,
    availableInputTokens: Math.max(0, modelContextTokens - promptTokens - reserve.output - reserve.safety) };
}

export function selectChunksForStage(chunks: DocumentChunk[], stage: ChunkStage, promptText = '', modelContextTokens?: number): DocumentChunk[][] {
  const budget = tokenBudgetForStage(stage, promptText, modelContextTokens);
  if (budget.availableInputTokens <= 0) throw new Error(`No input token budget for ${stage}`);
  const batches: DocumentChunk[][] = [];
  let current: DocumentChunk[] = [];
  let used = 0;
  for (const chunk of chunks) {
    if (chunk.estimatedTokens > budget.availableInputTokens) throw new Error(`Chunk ${chunk.id} exceeds ${stage} input budget`);
    if (current.length && used + chunk.estimatedTokens > budget.availableInputTokens) { batches.push(current); current = []; used = 0; }
    current.push(chunk); used += chunk.estimatedTokens;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function mergeStageResults<T>(batches: T[][], identity: (value: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const batch of batches) for (const value of batch) if (!merged.has(identity(value))) merged.set(identity(value), value);
  return [...merged.values()];
}
