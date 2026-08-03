import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { isConfigured, sendMessage } from './ai.js';
import type { DifficultyRatio } from '@exam-maker/shared';

// ====== Types ======
export interface BlueprintEntry {
  src: string;           // source file name
  no: string;            // question number (e.g. "一.1", "三.2")
  type: string;          // question type (选择题/填空题/计算题/证明题...)
  points: number;        // score
  kp: string[];          // knowledge points
  difficulty: '基础' | '中等' | '难';
  cognition: '记忆' | '理解' | '应用' | '分析' | '评价/综合';
  stem_kind: string;     // question pattern / approach
  note?: string;         // additional notes
}

export interface BlueprintResult {
  entries: BlueprintEntry[];
  kpList: KnowledgePointDef[];
  matrix: BlueprintMatrix;
  difficultySummary: DifficultySummary;
  verified: boolean;
  verifyNotes: string[];
}

export interface KnowledgePointDef {
  id: string;       // e.g. "K1"
  name: string;     // e.g. "特征值与特征向量"
  description: string;
  frequency: number;
  totalPoints: number;
  isRequired: boolean;
}

export interface BlueprintMatrix {
  headers: string[];       // ["基础", "中等", "难", "合计分"]
  rows: BlueprintMatrixRow[];
  columnTotals: number[];
}

export interface BlueprintMatrixRow {
  kpId: string;
  kpName: string;
  basic: number;
  medium: number;
  hard: number;
  total: number;
  frequency: number;
  isRequired: boolean;
}

export interface DifficultySummary {
  basic: { target: number; actual: number; passed: boolean };
  medium: { target: number; actual: number; passed: boolean };
  hard: { target: number; actual: number; passed: boolean };
}

// ====== Main Analysis ======
export async function analyzeBlueprint(
  projectId: number,
  course: string,
  scope: string | null,
  difficulty: DifficultyRatio
): Promise<BlueprintResult> {
  const result: BlueprintResult = {
    entries: [],
    kpList: [],
    matrix: { headers: ['基础', '中等', '难', '合计分'], rows: [], columnTotals: [0, 0, 0, 0] },
    difficultySummary: {
      basic: { target: difficulty.basic, actual: 0, passed: false },
      medium: { target: difficulty.medium, actual: 0, passed: false },
      hard: { target: difficulty.hard, actual: 0, passed: false },
    },
    verified: false,
    verifyNotes: [],
  };

  // Collect parsed tex files
  const texFiles = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, 'source_tex'),
    ))
    .all();

  if (texFiles.length === 0) {
    addEvent(projectId, 'step-2', 'log', '⚠ 未找到已解析的真题 LaTeX，无法进行考点分析');
    return result;
  }

  addEvent(projectId, 'step-2', 'log', '🔍 启动考点分析子代理...');
  addEvent(projectId, 'step-2', 'log', `📋 分析 ${texFiles.length} 份真题源文件`);

  // Phase 1: Analyze each question → extract structured entries
  addEvent(projectId, 'step-2', 'progress', '📊 正在逐题分析考点...');
  result.entries = await analyzeQuestions(projectId, texFiles, course, scope);

  if (result.entries.length === 0) {
    addEvent(projectId, 'step-2', 'log', '⚠ AI 分析未产生结果，请检查 ANTHROPIC_API_KEY 或真题内容');
    return result;
  }

  addEvent(projectId, 'step-2', 'log', `✅ 已分析 ${result.entries.length} 道题目`);

  // Phase 2: Build knowledge point list
  addEvent(projectId, 'step-2', 'progress', '🏷️ 正在归纳考点分类...');
  result.kpList = buildKpList(result.entries);
  addEvent(projectId, 'step-2', 'log', `✅ 归纳出 ${result.kpList.length} 个考点`);

  // Phase 3: Build matrix
  addEvent(projectId, 'step-2', 'progress', '📐 正在构建双向细目表...');
  result.matrix = buildMatrix(result.entries, result.kpList);
  addEvent(projectId, 'step-2', 'log', '✅ 双向细目表已构建');

  // Phase 4: Compute difficulty distribution
  result.difficultySummary = computeDifficulty(result.entries, difficulty);

  // Phase 5: Verification pass
  addEvent(projectId, 'step-2', 'progress', '🔍 启动核对子代理，检查分类一致性...');
  result.verified = await verifyBlueprint(projectId, result, course);
  result.verifyNotes = await getVerifyNotes(projectId, result);

  if (result.verified) {
    addEvent(projectId, 'step-2', 'log', '✅ 核对通过：考点分类一致、覆盖完整');
  } else {
    addEvent(projectId, 'step-2', 'log', '⚠ 核对发现改进点（详见细目表产物），请教师审核');
  }

  // Save outputs
  saveBlueprintOutputs(projectId, result);

  return result;
}

// ====== Phase 1: Question-level Analysis ======
async function analyzeQuestions(
  projectId: number,
  texFiles: Array<typeof schema.projectFiles.$inferSelect>,
  course: string,
  scope: string | null
): Promise<BlueprintEntry[]> {
  if (!isConfigured()) {
    addEvent(projectId, 'step-2', 'log', '⚠ ANTHROPIC_API_KEY 未设置，使用启发式分析');
    return heuristicAnalysis(texFiles);
  }

  const allEntries: BlueprintEntry[] = [];

  for (const texFile of texFiles) {
    let content: string;
    try {
      content = readFileSync(texFile.filepath, 'utf-8');
    } catch {
      addEvent(projectId, 'step-2', 'log', `⚠ 无法读取 ${texFile.filename}`);
      continue;
    }

    if (content.trim().length < 100) continue;

    const src = texFile.filename.replace('.tex', '');

    try {
      const prompt = buildAnalyzePrompt(content, src, course, scope);
      const response = await sendMessage(
        '你是学科试卷分析专家。严格按JSONL格式输出，每题一行。每行是一个完整的JSON对象。不输出任何JSON之外的文字。',
        [{ role: 'user', content: prompt }],
        { maxTokens: 8000 }
      );

      // Parse JSONL from response
      const entries = parseJsonl<BlueprintEntry>(response, [
        'src', 'no', 'type', 'points', 'kp', 'difficulty', 'cognition', 'stem_kind',
      ]);

      for (const entry of entries) {
        entry.src = src; // Override to our canonical source name
      }

      allEntries.push(...entries);
      addEvent(projectId, 'step-2', 'log', `  📝 ${src}: 识别 ${entries.length} 题`);
    } catch (err) {
      addEvent(projectId, 'step-2', 'error',
        `  分析 ${src} 失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return allEntries;
}

function buildAnalyzePrompt(
  texContent: string, src: string, course: string, scope: string | null
): string {
  return `请分析以下《${course}》真题 LaTeX，**逐题**提取考点信息。

## 输出格式（JSONL，每题一行，完整 JSON 对象）
{"src":"${src}","no":"一.1","type":"选择题","points":3,"kp":["考点名"],"difficulty":"基础","cognition":"理解","stem_kind":"直接计算求值"}
{"src":"${src}","no":"一.2","type":"选择题","points":3,"kp":["考点名"],"difficulty":"中等","cognition":"应用","stem_kind":"含参讨论"}

## 字段说明
- **no**: 题号（如"一.1"、"二"、"三.2"），保持与原文一致
- **type**: 题型（选择题/填空题/计算题/证明题/简答题/论述题…）
- **points**: 该题/小题分值（标注了\\score{}的取该值，否则按总分/题量估算）
- **kp**: 主考考点数组，每题1-2个考点，用标准学术名称
- **difficulty**: 基础/中等/难。判据：
  - 基础＝单一考点、直接套用、步骤少、认真复习必得分
  - 中等＝2考点综合或需转化、含参基本情形
  - 难＝多考点综合、严谨论证、多步推理，但不超纲不偏怪
- **cognition**: 记忆/理解/应用/分析/评价综合
- **stem_kind**: 设问特征短语（如"给矩阵求特征值"、"由条件证明结论"、"判断并说明理由"），用于后续命题变形轮换

${scope ? `## 命题范围\n${scope}\n` : ''}
## 真题 LaTeX 内容
${texContent.slice(0, 10000)}`;
}

// ====== Phase 2: Knowledge Point List ======
function buildKpList(entries: BlueprintEntry[]): KnowledgePointDef[] {
  // Collect all unique KPs with stats
  const kpMap = new Map<string, { frequency: number; totalPoints: number }>();

  for (const entry of entries) {
    for (const kp of entry.kp) {
      const existing = kpMap.get(kp) || { frequency: 0, totalPoints: 0 };
      existing.frequency++;
      existing.totalPoints += entry.points / entry.kp.length; // Split points across KPs
      kpMap.set(kp, existing);
    }
  }

  // Sort by totalPoints descending
  const sorted = [...kpMap.entries()]
    .sort((a, b) => b[1].totalPoints - a[1].totalPoints);

  // Label K1, K2, ...
  return sorted.map(([name, stats], i) => ({
    id: `K${i + 1}`,
    name,
    description: '',
    frequency: stats.frequency,
    totalPoints: Math.round(stats.totalPoints * 10) / 10,
    isRequired: stats.frequency >= 2, // Appear 2+ times = required
  }));
}

// ====== Phase 3: Build B-Spec Matrix ======
function buildMatrix(
  entries: BlueprintEntry[],
  kpList: KnowledgePointDef[]
): BlueprintResult['matrix'] {
  const kpMap = new Map(kpList.map(k => [k.name, k]));
  const rows: BlueprintMatrixRow[] = [];

  for (const kp of kpList) {
    let basic = 0, medium = 0, hard = 0;

    for (const entry of entries) {
      if (entry.kp.some(k => k === kp.name)) {
        const share = entry.points / entry.kp.length;
        if (entry.difficulty === '基础') basic += share;
        else if (entry.difficulty === '中等') medium += share;
        else hard += share;
      }
    }

    const total = basic + medium + hard;
    rows.push({
      kpId: kp.id,
      kpName: kp.name,
      basic: Math.round(basic * 10) / 10,
      medium: Math.round(medium * 10) / 10,
      hard: Math.round(hard * 10) / 10,
      total: Math.round(total * 10) / 10,
      frequency: kp.frequency,
      isRequired: kp.isRequired,
    });
  }

  // Column totals
  const columnTotals = [
    Math.round(rows.reduce((s, r) => s + r.basic, 0) * 10) / 10,
    Math.round(rows.reduce((s, r) => s + r.medium, 0) * 10) / 10,
    Math.round(rows.reduce((s, r) => s + r.hard, 0) * 10) / 10,
    Math.round(rows.reduce((s, r) => s + r.total, 0) * 10) / 10,
  ];

  return { headers: ['基础', '中等', '难', '合计分'], rows, columnTotals };
}

// ====== Phase 4: Difficulty Summary ======
function computeDifficulty(
  entries: BlueprintEntry[], target: DifficultyRatio
): DifficultySummary {
  const totalPoints = entries.reduce((s, e) => s + e.points, 0);
  if (totalPoints === 0) {
    return {
      basic: { target: target.basic, actual: 0, passed: false },
      medium: { target: target.medium, actual: 0, passed: false },
      hard: { target: target.hard, actual: 0, passed: false },
    };
  }

  let basicPoints = 0, mediumPoints = 0, hardPoints = 0;

  for (const entry of entries) {
    if (entry.difficulty === '基础') basicPoints += entry.points;
    else if (entry.difficulty === '中等') mediumPoints += entry.points;
    else hardPoints += entry.points;
  }

  const basicPct = Math.round(basicPoints / totalPoints * 100);
  const mediumPct = Math.round(mediumPoints / totalPoints * 100);
  const hardPct = Math.round(hardPoints / totalPoints * 100);

  return {
    basic: { target: target.basic, actual: basicPct, passed: Math.abs(basicPct - target.basic) <= 5 },
    medium: { target: target.medium, actual: mediumPct, passed: Math.abs(mediumPct - target.medium) <= 5 },
    hard: { target: target.hard, actual: hardPct, passed: Math.abs(hardPct - target.hard) <= 5 },
  };
}

// ====== Phase 5: Verification ======
async function verifyBlueprint(
  projectId: number, result: BlueprintResult, course: string
): Promise<boolean> {
  if (!isConfigured() || result.entries.length === 0) return false;

  try {
    const entriesSummary = result.entries.slice(0, 30).map(e =>
      `${e.no}|${e.type}|${e.points}分|${e.kp.join('/')}|${e.difficulty}|${e.cognition}|${e.stem_kind}`
    ).join('\n');

    const verifyPrompt = `你是一位严谨的学科分析核对员。请独立核对以下《${course}》考点分析结果：

## 考点清单
${result.kpList.map(k => `${k.id}: ${k.name} (出现${k.frequency}次, 合计${k.totalPoints}分)`).join('\n')}

## 逐题分析（前30题）
题号|题型|分值|考点|难度|认知层次|设问范式
${entriesSummary}

## 核对清单（逐条回复 PASS 或 FAIL+原因）
1. 考点归类是否合理？有无明显误分类？
2. 难度判定是否一致？（同类型/同考点题目难度是否前后矛盾）
3. 考点粒度是否合适？（不过粗不过细，能指导命题）
4. 认知层次判定是否准确？
5. 是否有重要考点遗漏？

最后输出一行：VERDICT: PASS 或 VERDICT: FAIL`;

    const response = await sendMessage(
      '你是学科分析核对员。独立比对，严格审查。每个核对项必须明确PASS或FAIL并附理由。',
      [{ role: 'user', content: verifyPrompt }],
      { maxTokens: 3000 }
    );

    return response.includes('VERDICT: PASS');
  } catch {
    return false;
  }
}

async function getVerifyNotes(projectId: number, result: BlueprintResult): Promise<string[]> {
  return [
    `总题数: ${result.entries.length}`,
    `考点数: ${result.kpList.length}`,
    `必考考点: ${result.kpList.filter(k => k.isRequired).map(k => k.name).join('、') || '无'}`,
    `难度分布: 基础${result.difficultySummary.basic.actual}% / 中等${result.difficultySummary.medium.actual}% / 难${result.difficultySummary.hard.actual}%`,
  ];
}

// ====== Save Outputs ======
function saveBlueprintOutputs(projectId: number, result: BlueprintResult): void {
  const dir = getProjectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Save blueprint.jsonl
  const jsonlPath = join(dir, 'blueprint.jsonl');
  const jsonlContent = result.entries.map(e => JSON.stringify(e)).join('\n');
  writeFileSync(jsonlPath, jsonlContent, 'utf-8');

  // Save blueprint.md
  const mdPath = join(dir, 'blueprint.md');
  writeFileSync(mdPath, generateBlueprintMd(result), 'utf-8');

  // Record files
  for (const { filepath, filename, type } of [
    { filepath: jsonlPath, filename: 'blueprint.jsonl', type: 'blueprint' },
    { filepath: mdPath, filename: 'blueprint.md', type: 'blueprint' },
  ]) {
    const existing = db.select().from(schema.projectFiles)
      .where(and(
        eq(schema.projectFiles.projectId, projectId),
        eq(schema.projectFiles.filename, filename),
      ))
      .get();

    if (existing) {
      db.update(schema.projectFiles)
        .set({ filepath, metadata: JSON.stringify({ entries: result.entries.length, verified: result.verified }) })
        .where(eq(schema.projectFiles.id, existing.id)).run();
    } else {
      db.insert(schema.projectFiles).values({
        projectId, type, filename, filepath,
        metadata: JSON.stringify({ entries: result.entries.length, verified: result.verified }),
      }).run();
    }
  }

  saveToDisk();
}

// ====== Markdown Generation ======
function generateBlueprintMd(result: BlueprintResult): string {
  const lines: string[] = [];

  lines.push('# 双向细目表');
  lines.push('');
  lines.push(`> 分析题数: ${result.entries.length} | 考点数: ${result.kpList.length} | 核对: ${result.verified ? '✅ PASS' : '⚠ 待教师审核'}`);
  lines.push('');

  // Difficulty summary
  lines.push('## 难度分布（按分值）');
  lines.push('');
  lines.push('| 难度 | 目标占比 | 实际占比 | 状态 |');
  lines.push('|------|----------|----------|------|');
  for (const [label, ds] of [
    ['基础', result.difficultySummary.basic] as const,
    ['中等', result.difficultySummary.medium] as const,
    ['难', result.difficultySummary.hard] as const,
  ]) {
    lines.push(`| ${label} | ${ds.target}% | ${ds.actual}% | ${ds.passed ? '✅ 达标' : '⚠ 偏差'}|`);
  }
  lines.push('');

  // KP list
  lines.push('## 考点清单');
  lines.push('');
  lines.push('| 编号 | 考点名称 | 出现频次 | 合计分值 | 是否必考 |');
  lines.push('|------|----------|----------|----------|----------|');
  for (const kp of result.kpList) {
    lines.push(`| ${kp.id} | ${kp.name} | ${kp.frequency} | ${kp.totalPoints} | ${kp.isRequired ? '⭐ 必考' : ''} |`);
  }
  lines.push('');

  // Bidirectional spec table (KP × Difficulty)
  lines.push('## 考点 × 难度矩阵（双向细目表）');
  lines.push('');
  lines.push('| 考点 | 基础 | 中等 | 难 | 合计分 | 频次 | 必考 |');
  lines.push('|------|------|------|-----|--------|------|------|');
  for (const row of result.matrix.rows) {
    lines.push(`| ${row.kpName} | ${row.basic || '-'} | ${row.medium || '-'} | ${row.hard || '-'} | ${row.total} | ${row.frequency} | ${row.isRequired ? '⭐' : ''} |`);
  }
  lines.push(`| **合计** | **${result.matrix.columnTotals[0]}** | **${result.matrix.columnTotals[1]}** | **${result.matrix.columnTotals[2]}** | **${result.matrix.columnTotals[3]}** | | |`);
  lines.push('');

  // Question → KP mapping
  lines.push('## 逐题考点映射');
  lines.push('');
  lines.push('| 题号 | 题型 | 分值 | 考点 | 难度 | 认知层次 | 设问范式 |');
  lines.push('|------|------|------|------|------|----------|----------|');
  for (const entry of result.entries) {
    lines.push(`| ${entry.no} | ${entry.type} | ${entry.points} | ${entry.kp.join('、')} | ${entry.difficulty} | ${entry.cognition} | ${entry.stem_kind} |`);
  }
  lines.push('');

  // Verify notes
  if (result.verifyNotes.length > 0) {
    lines.push('## 核对备注');
    lines.push('');
    for (const note of result.verifyNotes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}

// ====== Heuristic fallback (no AI) ======
function heuristicAnalysis(texFiles: Array<typeof schema.projectFiles.$inferSelect>): BlueprintEntry[] {
  const entries: BlueprintEntry[] = [];
  const typeHints: Record<string, string> = {
    '选择': '选择题', '填空': '填空题', '计算': '计算题',
    '证明': '证明题', '简答': '简答题', '判断': '判断题',
    '论述': '论述题', '综合': '综合题',
  };

  for (const f of texFiles) {
    let content: string;
    try { content = readFileSync(f.filepath, 'utf-8'); } catch { continue }

    // Extract all \score{n} with their positions
    const scoreRe = /\\score\{(\d+(?:\.\d+)?)\}/g;
    const scoreMatches: Array<{ index: number; value: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = scoreRe.exec(content)) !== null) {
      scoreMatches.push({ index: match.index, value: Number(match[1]) });
    }

    // Find section headers and question numbers
    const sectionRe = /(?:^|\n)\s*([一二三四五六七八九十]+)[、．.]\s*([^\n]*)/gm;
    const itemRe = /(?:^|\n)\s*(\d{1,2})[\.\)、]\s*([^\n]*)/gm;

    // Build a list of all "anchors" with their positions
    const anchors: Array<{ index: number; label: string; line: string; isSection: boolean }> = [];

    while ((match = sectionRe.exec(content)) !== null) {
      anchors.push({
        index: match.index,
        label: match[1] + '、',
        line: match[2].trim(),
        isSection: true,
      });
    }

    while ((match = itemRe.exec(content)) !== null) {
      const num = Number(match[1]);
      // Skip if it looks like a page number or isn't a question number
      if (num > 0 && num <= 100) {
        anchors.push({
          index: match.index,
          label: String(num),
          line: match[2].trim(),
          isSection: false,
        });
      }
    }

    // Sort anchors by position
    anchors.sort((a, b) => a.index - b.index);

    // Detect section type from section header
    let currentSection = '';
    let currentType = '未知';

    // Match scores to the nearest preceding anchor
    let anchorIdx = 0;
    for (const sm of scoreMatches) {
      // Advance anchor pointer to the one just before this score
      while (anchorIdx + 1 < anchors.length && anchors[anchorIdx + 1].index < sm.index) {
        anchorIdx++;
      }

      // Update section context
      for (let i = anchorIdx; i >= 0; i--) {
        if (anchors[i].isSection) {
          currentSection = anchors[i].label;
          // Guess type from section line
          for (const [keyword, typeName] of Object.entries(typeHints)) {
            if (anchors[i].line.includes(keyword)) {
              currentType = typeName;
              break;
            }
          }
          break;
        }
      }

      // Find the closest preceding non-section anchor (actual question number)
      let itemLabel = '';
      for (let i = anchorIdx; i >= 0; i--) {
        if (!anchors[i].isSection) {
          itemLabel = currentSection + anchors[i].label;
          break;
        }
      }

      if (!itemLabel) {
        itemLabel = currentSection ? `${currentSection}${anchorIdx + 1}` : `题${entries.length + 1}`;
      }

      // Estimate difficulty from position and score
      const totalQuestions = scoreMatches.length;
      const positionRatio = entries.length / totalQuestions;
      let difficulty: BlueprintEntry['difficulty'] = '中等';
      if (positionRatio < 0.5) difficulty = '基础';
      else if (positionRatio > 0.85) difficulty = '难';

      entries.push({
        src: f.filename.replace('.tex', ''),
        no: itemLabel,
        type: currentType,
        points: sm.value,
        kp: ['待分类'],
        difficulty,
        cognition: difficulty === '基础' ? '理解' : difficulty === '难' ? '应用' : '应用',
        stem_kind: '待分析',
        note: `启发式分析（${anchors.length}个锚点, ${scoreMatches.length}个\\score）。设置 ANTHROPIC_API_KEY 启用 AI 深度考点分析`,
      });
    }

    // If no \score found but we have sections and items
    if (scoreMatches.length === 0 && anchors.length > 0) {
      const questionAnchors = anchors.filter(a => !a.isSection);
      const totalPerQuestion = questionAnchors.length > 0 ? Math.round(100 / questionAnchors.length) : 10;

      for (const anchor of questionAnchors) {
        entries.push({
          src: f.filename.replace('.tex', ''),
          no: anchor.label,
          type: currentType,
          points: totalPerQuestion,
          kp: ['待分类'],
          difficulty: '中等',
          cognition: '理解',
          stem_kind: '待分析',
          note: `无\\score标注，分值按均分估算。设置 ANTHROPIC_API_KEY 启用 AI 分析`,
        });
      }
    }
  }
  return entries;
}

// ====== JSONL Parser ======
function parseJsonl<T extends object>(
  text: string,
  requiredFields: string[]
): T[] {
  const results: T[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Try to find JSON object in the line (handle markdown code blocks)
    const jsonMatch = line.match(/\{.*\}/s);
    if (!jsonMatch) continue;

    try {
      const obj = JSON.parse(jsonMatch[0]) as T;
      // Validate required fields
      const missing = requiredFields.filter(f => !(f in obj));
      if (missing.length > 0) {
        // Try to fix common issues
        const fixed = { ...obj } as Record<string, unknown>;
        for (const f of missing) {
          if (f === 'points') fixed.points = 0;
          else if (f === 'kp') fixed.kp = ['未分类'];
          else if (f === 'difficulty') fixed.difficulty = '中等';
          else if (f === 'cognition') fixed.cognition = '理解';
          else if (f === 'stem_kind') fixed.stem_kind = '未知';
          else fixed[f] = '';
        }
        results.push(fixed as unknown as T);
      } else {
        results.push(obj);
      }
    } catch {
      // skip malformed JSON
    }
  }

  return results;
}

// Re-export for use in workflow
import { and, eq } from 'drizzle-orm';

function getProjectDir(projectId: number): string {
  return join(process.cwd(), 'data', 'projects', String(projectId));
}
