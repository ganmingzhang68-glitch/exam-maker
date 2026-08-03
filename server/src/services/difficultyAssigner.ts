import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { getProjectDir } from './workflow.js';
import { and, eq } from 'drizzle-orm';
import type { DifficultyRatio } from '@exam-maker/shared';
import { isConfigured, sendMessage } from './ai.js';

// ====== Types ======
export interface QuestionSlot {
  sectionType: string;       // 选择题/填空题...
  sectionIndex: number;      // which section
  questionIndex: number;     // which question within section (1-based)
  score: number;             // points for this question/slot
  difficulty: '基础' | '中等' | '难';
  splitFrom?: string;        // if split from a larger question, reference
  note?: string;
}

export interface DifficultyAssignment {
  target: DifficultyRatio;
  totalScore: number;
  slots: QuestionSlot[];
  // Accountability
  basicTotal: number;
  mediumTotal: number;
  hardTotal: number;
  basicPct: number;
  mediumPct: number;
  hardPct: number;
  passed: boolean;
  // Split suggestions
  splits: SplitRecord[];
}

export interface SplitRecord {
  originalSection: string;
  originalQuestionIndex: number;
  originalScore: number;
  subSlots: Array<{ difficulty: string; score: number; description: string }>;
}

// ====== Main Assignment ======
export async function assignDifficulty(
  projectId: number,
  target: DifficultyRatio
): Promise<DifficultyAssignment> {
  const dir = getProjectDir(projectId);

  // Read template
  let template: { sections: Array<{ type: string; count: number; pointsPerQuestion: number; subtotal: number }>; totalScore: number };
  try {
    const templateJson = readFileSync(join(dir, 'template.json'), 'utf-8');
    template = JSON.parse(templateJson);
  } catch {
    throw new Error('模板文件 (template.json) 不存在，请先完成步骤3');
  }

  // Read blueprint for difficulty hints
  let blueprintEntries: Array<{ difficulty: string; points: number; no: string }> = [];
  try {
    const bpContent = readFileSync(join(dir, 'blueprint.jsonl'), 'utf-8');
    blueprintEntries = bpContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  } catch {
    // No blueprint, proceed without reference
  }

  addEvent(projectId, 'step-4', 'log', `🎯 目标配比: 基础${target.basic}% / 中等${target.medium}% / 难${target.hard}%`);
  addEvent(projectId, 'step-4', 'log', `📊 模板总分: ${template.totalScore}, 大题: ${template.sections.length}种`);

  // Phase 1: Build slots from template
  const slots = buildSlots(template, blueprintEntries);
  addEvent(projectId, 'step-4', 'log', `📋 展开 ${slots.length} 个题位（含小问拆分）`);

  // Phase 2: Assign difficulties
  const result = computeAssignment(slots, target, template.totalScore);

  // Phase 3: Check and adjust
  if (!result.passed) {
    addEvent(projectId, 'step-4', 'log',
      `⚠ 难度偏差超标，尝试AI拆分大题微调...`);
    const adjusted = await tryAdjustWithAI(result, target, template, projectId);
    if (adjusted) {
      Object.assign(result, adjusted);
    }
  }

  // Phase 4: Emit summary
  addEvent(projectId, 'step-4', 'log',
    `📈 核算结果: 基础${result.basicPct}% / 中等${result.mediumPct}% / 难${result.hardPct}% ${result.passed ? '✅' : '⚠'}`);
  for (const s of result.splits) {
    addEvent(projectId, 'step-4', 'log',
      `  ✂️ ${s.originalSection}: ${s.originalScore}分 拆为 ${s.subSlots.map(ss => `${ss.description}(${ss.score}分/${ss.difficulty})`).join(' + ')}`);
  }

  // Save
  saveAssignmentOutputs(projectId, result, template);

  return result;
}

// ====== Phase 1: Build Slots ======
function buildSlots(
  template: { sections: Array<{ type: string; count: number; pointsPerQuestion: number }> },
  blueprintEntries: Array<{ difficulty: string; points: number; no: string }>
): QuestionSlot[] {
  const slots: QuestionSlot[] = [];

  // Build a lookup: question_no → difficulty from blueprint
  const bpMap = new Map<string, string>();
  for (const bp of blueprintEntries) {
    bpMap.set(bp.no, bp.difficulty);
  }

  let questionCounter = 0;
  let bpIdx = 0;

  for (const [sectionIndex, section] of template.sections.entries()) {
    for (let q = 1; q <= section.count; q++) {
      questionCounter++;
      // Try to get difficulty from blueprint if available
      let difficulty: QuestionSlot['difficulty'] = '中等';
      if (bpIdx < blueprintEntries.length) {
        difficulty = normalizeDifficulty(blueprintEntries[bpIdx].difficulty);
        bpIdx++;
      } else {
        // Estimate from position: early questions easier, later ones harder
        if (questionCounter <= Math.ceil(slots.length / 3)) difficulty = '基础';
        else if (questionCounter > slots.length * 0.85) difficulty = '难';
      }

      // For large-points questions, potentially split into sub-slots
      if (section.pointsPerQuestion >= 10) {
        // Split large questions into sub-parts for finer difficulty control
        const splitSlots = splitLargeQuestion(section.type, q, section.pointsPerQuestion, difficulty);
        slots.push(...splitSlots);
      } else {
        slots.push({
          sectionType: section.type,
          sectionIndex,
          questionIndex: q,
          score: section.pointsPerQuestion,
          difficulty,
        });
      }
    }
  }

  return slots;
}

function splitLargeQuestion(
  sectionType: string, qIndex: number,
  totalScore: number, baseDifficulty: string
): QuestionSlot[] {
  const subSlots: QuestionSlot[] = [];
  const isEasy = baseDifficulty === '基础';

  if (totalScore >= 12) {
    // 12-point question: split into 3 parts (small-easy → medium → hard)
    const part1Score = isEasy ? 6 : 4;
    const part2Score = isEasy ? 4 : 4;
    const part3Score = totalScore - part1Score - part2Score;
    subSlots.push({ sectionType, sectionIndex: 0, questionIndex: qIndex, score: part1Score, difficulty: '基础', note: '(1)' });
    subSlots.push({ sectionType, sectionIndex: 0, questionIndex: qIndex, score: part2Score, difficulty: '中等', note: '(2)', splitFrom: `${sectionType}${qIndex}` });
    subSlots.push({ sectionType, sectionIndex: 0, questionIndex: qIndex, score: part3Score, difficulty: '难', note: '(3)', splitFrom: `${sectionType}${qIndex}` });
  } else if (totalScore >= 8) {
    // 8-11 point question: split into 2 parts
    const part1Score = Math.floor(totalScore * 0.5);
    subSlots.push({ sectionType, sectionIndex: 0, questionIndex: qIndex, score: part1Score, difficulty: '基础', note: '(1)' });
    subSlots.push({ sectionType, sectionIndex: 0, questionIndex: qIndex, score: totalScore - part1Score, difficulty: '中等', note: '(2)', splitFrom: `${sectionType}${qIndex}` });
  } else {
    // Keep as is
    subSlots.push({ sectionType, sectionIndex: 0, questionIndex: qIndex, score: totalScore, difficulty: normalizeDifficulty(baseDifficulty) });
  }

  return subSlots;
}

// ====== Phase 2: Compute Assignment ======
function computeAssignment(
  slots: QuestionSlot[],
  target: DifficultyRatio,
  totalScore: number
): DifficultyAssignment {
  // Recompute totals from current slot difficulties
  let basicTotal = 0, mediumTotal = 0, hardTotal = 0;

  for (const s of slots) {
    if (s.difficulty === '基础') basicTotal += s.score;
    else if (s.difficulty === '中等') mediumTotal += s.score;
    else hardTotal += s.score;
  }

  const actualTotal = basicTotal + mediumTotal + hardTotal;

  const result: DifficultyAssignment = {
    target,
    totalScore: actualTotal || totalScore,
    slots,
    basicTotal,
    mediumTotal,
    hardTotal,
    basicPct: Math.round(basicTotal / actualTotal * 100),
    mediumPct: Math.round(mediumTotal / actualTotal * 100),
    hardPct: Math.round(hardTotal / actualTotal * 100),
    passed: false,
    splits: [],
  };

  // Check if within tolerance (±5%, relaxed from ±3% for initial pass)
  result.passed =
    Math.abs(result.basicPct - target.basic) <= 5 &&
    Math.abs(result.mediumPct - target.medium) <= 5 &&
    Math.abs(result.hardPct - target.hard) <= 5;

  return result;
}

// ====== Phase 3: AI-assisted Micro-adjustment ======
async function tryAdjustWithAI(
  result: DifficultyAssignment,
  target: DifficultyRatio,
  template: { sections: Array<{ type: string; count: number; pointsPerQuestion: number; subtotal: number }>; totalScore: number },
  projectId: number
): Promise<Partial<DifficultyAssignment> | null> {
  if (!isConfigured()) {
    addEvent(projectId, 'step-4', 'log', '🔧 AI 未配置，使用纯计算调整...');
    return tryAutoAdjust(result, target, template);
  }

  try {
    const prompt = `## 难度配比核算

目标: 基础${target.basic}% / 中等${target.medium}% / 难${target.hard}%（容差 ±3%）
总分: ${result.totalScore}

当前状态:
- 基础 ${result.basicTotal}分 (${result.basicPct}%)
- 中等 ${result.mediumTotal}分 (${result.mediumPct}%)
- 难 ${result.hardTotal}分 (${result.hardPct}%)

偏差:
- 基础需${target.basic - result.basicPct > 0 ? '增加' : '减少'}${Math.abs(target.basic - result.basicPct)}% ≈ ${Math.abs(Math.round(target.basic/100*result.totalScore) - result.basicTotal)}分
- 中等需${target.medium - result.mediumPct > 0 ? '增加' : '减少'}${Math.abs(target.medium - result.mediumPct)}% ≈ ${Math.abs(Math.round(target.medium/100*result.totalScore) - result.mediumTotal)}分
- 难需${target.hard - result.hardPct > 0 ? '增加' : '减少'}${Math.abs(target.hard - result.hardPct)}% ≈ ${Math.abs(Math.round(target.hard/100*result.totalScore) - result.hardTotal)}分

大题结构:
${template.sections.map(s => `- ${s.type}: ${s.count}题 × ${s.pointsPerQuestion}分 = ${s.subtotal}分`).join('\n')}

## 任务
把超过8分的大题拆成不同难度的小问来微调难度配比。输出 JSON:
{
  "splits": [
    {"section": "计算题", "qIndex": 1, "originalScore": 12, "subSlots": [
      {"difficulty": "基础", "score": 4, "description": "(1)直接计算"},
      {"difficulty": "中等", "score": 4, "description": "(2)综合步骤"},
      {"difficulty": "难", "score": 4, "description": "(3)证明/推广"}
    ]}
  ]
}`;

    const response = await sendMessage(
      '你是考试难度核算专家。按分值拆大题小问命中目标配比。只输出JSON。',
      [{ role: 'user', content: prompt }],
      { maxTokens: 2000 }
    );

    // Parse AI suggestion
    const parsed = parseJson<{ splits: SplitRecord[] }>(response);
    if (parsed.splits && parsed.splits.length > 0) {
      result.splits = parsed.splits;

      // Apply splits: re-assign difficulties based on AI suggestions
      for (const split of parsed.splits) {
        // Find the original slot and replace with sub-slots
        const idx = result.slots.findIndex(
          s => s.sectionType === split.originalSection &&
               s.questionIndex === split.originalQuestionIndex
        );
        if (idx >= 0) {
          const newSlots = split.subSlots.map(ss => ({
            sectionType: result.slots[idx].sectionType,
            sectionIndex: result.slots[idx].sectionIndex,
            questionIndex: result.slots[idx].questionIndex,
            score: ss.score,
            difficulty: normalizeDifficulty(ss.difficulty) as '基础' | '中等' | '难',
            note: ss.description,
            splitFrom: `${split.originalSection}${split.originalQuestionIndex}`,
          }));
          result.slots.splice(idx, 1, ...newSlots);
        }
      }

      // Recompute
      const updated = computeAssignment(result.slots, target, result.totalScore);
      return updated;
    }
  } catch (err) {
    addEvent(projectId, 'step-4', 'log',
      `  AI调整失败: ${err instanceof Error ? err.message : 'Unknown'}, 尝试自动调整...`);
  }

  return tryAutoAdjust(result, target, template);
}

function tryAutoAdjust(
  result: DifficultyAssignment, target: DifficultyRatio,
  template: { sections: Array<{ type: string; count: number; pointsPerQuestion: number }> }
): Partial<DifficultyAssignment> | null {
  // Simple heuristic: adjust large questions' difficulty split
  const adjustments: Array<{ idx: number; from: string; to: string; score: number }> = [];
  let basicDelta = Math.round(target.basic / 100 * result.totalScore) - result.basicTotal;

  for (let i = result.slots.length - 1; i >= 0 && basicDelta > 0; i--) {
    if (result.slots[i].difficulty === '中等' && result.slots[i].score <= basicDelta) {
      adjustments.push({ idx: i, from: '中等', to: '基础', score: result.slots[i].score });
      basicDelta -= result.slots[i].score;
    }
  }

  for (const adj of adjustments) {
    result.slots[adj.idx].difficulty = adj.to as '基础' | '中等' | '难';
  }

  return computeAssignment(result.slots, target, result.totalScore);
}

// ====== Save ======
function saveAssignmentOutputs(
  projectId: number,
  result: DifficultyAssignment,
  template: { sections: Array<{ type: string; count: number; pointsPerQuestion: number; subtotal: number }>; totalScore: number }
): void {
  const dir = getProjectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Save difficulty.json
  writeFileSync(join(dir, 'difficulty.json'), JSON.stringify({
    target: result.target,
    summary: {
      basic: { total: result.basicTotal, pct: result.basicPct },
      medium: { total: result.mediumTotal, pct: result.mediumPct },
      hard: { total: result.hardTotal, pct: result.hardPct },
      passed: result.passed,
    },
    slots: result.slots,
    splits: result.splits,
  }, null, 2), 'utf-8');

  // Append difficulty accounting to template.md
  const mdPath = join(dir, 'template.md');
  let mdContent = '';
  try { mdContent = readFileSync(mdPath, 'utf-8'); } catch { /* ignore */ }

  // Remove old difficulty section if exists
  mdContent = mdContent.replace(/\n## 难度核算[\s\S]*$/, '');

  // Append new difficulty section
  const diffMd = generateDifficultyMd(result, template);
  writeFileSync(mdPath, mdContent.trimEnd() + '\n\n' + diffMd, 'utf-8');

  // Record file
  const diffPath = join(dir, 'difficulty.json');
  const existing = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.filename, 'difficulty.json'),
    ))
    .get();

  if (!existing) {
    db.insert(schema.projectFiles).values({
      projectId, type: 'template', filename: 'difficulty.json', filepath: diffPath,
      metadata: JSON.stringify({ passed: result.passed }),
    }).run();
  } else {
    db.update(schema.projectFiles)
      .set({ filepath: diffPath, metadata: JSON.stringify({ passed: result.passed }) })
      .where(eq(schema.projectFiles.id, existing.id)).run();
  }

  saveToDisk();
}

function generateDifficultyMd(
  result: DifficultyAssignment,
  template: { sections: Array<{ type: string; count: number; pointsPerQuestion: number; subtotal: number }>; totalScore: number }
): string {
  const lines: string[] = [];
  lines.push('## 难度核算');
  lines.push('');
  lines.push(`> 目标: 基础${result.target.basic}% / 中等${result.target.medium}% / 难${result.target.hard}% | 容差: ±5%`);
  lines.push('');

  // Summary
  lines.push('### 核算结果');
  lines.push('');
  lines.push('| 难度 | 目标占比 | 实际分值 | 实际占比 | 状态 |');
  lines.push('|------|----------|----------|----------|------|');
  for (const [label, targetPct, actual, pct] of [
    ['基础', result.target.basic, result.basicTotal, result.basicPct] as const,
    ['中等', result.target.medium, result.mediumTotal, result.mediumPct] as const,
    ['难', result.target.hard, result.hardTotal, result.hardPct] as const,
  ]) {
    const passed = Math.abs(pct - targetPct) <= 5;
    lines.push(`| ${label} | ${targetPct}% | ${actual}分 | ${pct}% | ${passed ? '✅' : '⚠ 偏差'}|`);
  }
  lines.push(`| **合计** | **100%** | **${result.totalScore}分** | **100%** | |`);
  lines.push('');

  if (!result.passed) {
    lines.push('### ⚠ 偏差分析与调整建议');
    lines.push('');
    if (result.basicPct < result.target.basic) {
      lines.push(`- 基础题不足（${result.basicPct}% < ${result.target.basic}%）：建议将中等题的小问降为基础难度，或增加送分小问`);
    }
    if (result.mediumPct > result.target.medium) {
      lines.push(`- 中等题过多（${result.mediumPct}% > ${result.target.medium}%）：将部分中等小问升为难题或降为基础`);
    }
    if (result.hardPct > result.target.hard) {
      lines.push(`- 难题过多（${result.hardPct}% > ${result.target.hard}%）：将部分难的小问降为中等`);
    }
    lines.push('');
  }

  // Per-question difficulty assignment
  lines.push('### 逐题难度指派');
  lines.push('');
  lines.push('| 题型 | 题号 | 分值 | 难度 | 备注 |');
  lines.push('|------|------|------|------|------|');

  let currentType = '';
  let qCounter = 0;
  for (const slot of result.slots) {
    if (slot.sectionType !== currentType) {
      currentType = slot.sectionType;
      qCounter = 0;
    }
    qCounter++;
    const note = slot.note || slot.splitFrom ? (slot.note || `(拆分自${slot.splitFrom})`) : '';
    lines.push(`| ${currentType} | ${qCounter} | ${slot.score} | ${slot.difficulty} | ${note} |`);
  }
  lines.push('');

  // Self-check script
  lines.push('### 自检脚本');
  lines.push('');
  lines.push('```python');
  lines.push(`# 难度核算自检`);
  lines.push(`target = {"基础": ${result.target.basic}, "中等": ${result.target.medium}, "难": ${result.target.hard}}`);
  lines.push(`actual = {"基础": ${result.basicTotal}, "中等": ${result.mediumTotal}, "难": ${result.hardTotal}}`);
  lines.push(`total = ${result.totalScore}`);
  lines.push(`for k in target:`);
  lines.push(`    pct = round(actual[k] / total * 100)`);
  lines.push(`    ok = abs(pct - target[k]) <= 5`);
  lines.push(`    print(f"{k}: {actual[k]}分/{pct}% (目标{target[k]}%) {'✅' if ok else '⚠偏差'}")`);
  lines.push('```');

  return lines.join('\n');
}

// ====== Helpers ======
function normalizeDifficulty(d: string): QuestionSlot['difficulty'] {
  if (d.startsWith('基础') || d === '简单') return '基础';
  if (d.startsWith('中等')) return '中等';
  if (d.startsWith('难')) return '难';
  return '中等';
}

function parseJson<T>(text: string): T {
  try { return JSON.parse(text) as T; } catch { /* continue */ }
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) { try { return JSON.parse(block[1].trim()) as T; } catch { /* continue */ } }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) { try { return JSON.parse(brace[0]) as T; } catch { /* continue */ } }
  return {} as T;
}
