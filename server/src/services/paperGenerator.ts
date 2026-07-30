import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { getProjectDir } from './workflow.js';
import { isConfigured, sendMessage } from './ai.js';
import { eq } from 'drizzle-orm';
import type { DifficultyRatio } from '@exam-maker/shared';

interface LedgerEntry {
  setIndex: number;
  slotType: string;
  slotIndex: number;
  kp: string;           // knowledge point tested
  axis: string;         // deformation axis used (正逆/任务/表征/抽象/含参/综合/情境/粒度)
  pattern: string;      // specific question pattern
  keyData: string;      // key numbers/data used
}

interface GenerateResult {
  setIndex: number;
  texPath: string;
  texSize: number;
  verifyResults?: { total: number; passed: number };
  errors?: string[];
}

const DEFORM_AXES = [
  '①正↔逆', '②任务类型', '③表征', '④抽象度',
  '⑤含参化', '⑥综合', '⑦情境/载体', '⑧提问粒度',
];

export async function generatePapers(
  projectId: number, course: string, nSets: number,
  difficulty: DifficultyRatio, scope: string | null,
  verifyMode: string
): Promise<GenerateResult[]> {
  const dir = getProjectDir(projectId);
  const results: GenerateResult[] = [];

  // Gather context from all previous steps
  const blueprint = readStepFile(projectId, 'blueprint');
  const template = readStepFile(projectId, 'template');
  const difficultyData = readFileIfExists(join(dir, 'difficulty.json'));
  const texSources = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .where(eq(schema.projectFiles.type, 'source_tex'))
    .all();

  // Load ledger or create new
  const ledgerPath = join(dir, 'ledger.md');
  const ledger: LedgerEntry[] = loadLedger(ledgerPath);

  if (!isConfigured()) {
    addEvent(projectId, 'step-5', 'log', '⚠ AI 未配置，无法生成试卷');
    addEvent(projectId, 'step-5', 'log', '💡 设置 AI_API_KEY 环境变量以启用');
    return results;
  }

  addEvent(projectId, 'step-5', 'log', `📝 命题参数: ${nSets}套, 总分100, 难度${difficulty.basic}/${difficulty.medium}/${difficulty.hard}`);
  addEvent(projectId, 'step-5', 'log', `🔄 变形轴: ${DEFORM_AXES.join(', ')}`);
  addEvent(projectId, 'step-5', 'log', `📋 防重台账已加载: ${ledger.length} 条记录`);

  const paperDir = join(dir, 'papers');
  if (!existsSync(paperDir)) mkdirSync(paperDir, { recursive: true });

  for (let i = 1; i <= nSets; i++) {
    addEvent(projectId, 'step-5', 'progress', `正在生成第 ${i}/${nSets} 套...`);

    try {
      const result = await generateSinglePaper(
        projectId, i, nSets, course, difficulty, scope, verifyMode,
        blueprint, template, difficultyData, texSources, ledger
      );
      results.push(result);

      // Append to ledger
      if (result.ledgerEntries) {
        ledger.push(...result.ledgerEntries);
        saveLedger(ledgerPath, ledger);
      }

      // Save as project file
      db.insert(schema.projectFiles).values({
        projectId,
        type: 'generated_paper',
        filename: `paper-${i}.tex`,
        filepath: result.texPath,
        metadata: JSON.stringify({
          setNumber: i, difficulty, size: result.texSize,
          verified: result.verifyResults ? `${result.verifyResults.passed}/${result.verifyResults.total}` : null,
        }),
      }).run();

      if (result.verifyResults) {
        const icon = result.verifyResults.passed / result.verifyResults.total === 1 ? '✅' : '⚠';
        addEvent(projectId, 'step-5', 'log',
          ` ${icon} 第${i}套: ${result.texSize}字符, 验算${result.verifyResults.passed}/${result.verifyResults.total}`);
      } else {
        addEvent(projectId, 'step-5', 'log',
          `📄 第${i}套: paper-${i}.tex (${result.texSize} 字符)`);
      }

      saveToDisk();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      addEvent(projectId, 'step-5', 'error', `第${i}套生成失败: ${msg}`);
      results.push({ setIndex: i, texPath: '', texSize: 0, errors: [msg] });
    }
  }

  // Summary
  const successCount = results.filter(r => r.texSize > 0).length;
  addEvent(projectId, 'step-5', 'log', `📊 生成完成: ${successCount}/${nSets} 套成功`);
  addEvent(projectId, 'step-5', 'log', `📋 防重台账: ${ledger.length} 条`);

  return results;
}

async function generateSinglePaper(
  projectId: number, setIndex: number, nSets: number,
  course: string, difficulty: DifficultyRatio, scope: string | null,
  verifyMode: string,
  blueprint: string, template: string, difficultyData: string,
  texSources: Array<typeof schema.projectFiles.$inferSelect>,
  ledger: LedgerEntry[]
): Promise<GenerateResult & { ledgerEntries?: LedgerEntry[] }> {
  const systemPrompt = buildSystemPrompt(course, difficulty, scope, verifyMode, ledger, setIndex, nSets);
  const userPrompt = buildUserPrompt(setIndex, nSets, course, difficulty, blueprint, template, difficultyData, texSources, ledger);

  addEvent(projectId, 'step-5', 'log',
    `  🎲 第${setIndex}套: 按8轴轮换变形, 当前已用变形轴: ${usedAxes(ledger)}`);

  const response = await sendMessage(systemPrompt, [{ role: 'user', content: userPrompt }], { maxTokens: 32768 });

  // Extract LaTeX body from response
  const bodyContent = extractLatexBody(response);

  // Wrap in proper LaTeX document structure with preamble
  const texContent = wrapInDocument(bodyContent);

  const paperDir = join(getProjectDir(projectId), 'papers');
  const texPath = join(paperDir, `paper-${setIndex}.tex`);
  writeFileSync(texPath, texContent, 'utf-8');

  // Extract ledger entries from the generated paper
  const newLedgerEntries = extractLedgerEntries(texContent, setIndex);

  const result: GenerateResult & { ledgerEntries?: LedgerEntry[] } = {
    setIndex,
    texPath,
    texSize: texContent.length,
    ledgerEntries: newLedgerEntries,
  };

  // For computational subjects, generate verification
  if (verifyMode === 'computational' && texContent.length > 500) {
    result.verifyResults = await runVerification(projectId, setIndex, texContent, course);
  }

  // Run AI quality review
  await qualityReview(projectId, setIndex, texContent, blueprint, template, course);

  return result;
}

// ====== Prompt Building ======
function buildSystemPrompt(
  course: string, difficulty: DifficultyRatio,
  scope: string | null, verifyMode: string,
  ledger: LedgerEntry[], setIndex: number, nSets: number
): string {
  const usedAxesList = usedAxes(ledger);
  const remainingAxes = DEFORM_AXES.filter(a => !usedAxesList.includes(a));

  return `你是《${course}》资深命题专家。请独立命制第${setIndex}/${nSets}套模拟试卷。

## 核心红线
1. **结构对齐模板**：题型/题量/分值/时长严格与模板一致
2. **难度达标**：按分值配比 基础${difficulty.basic}%/中等${difficulty.medium}%/难${difficulty.hard}%，容差±5%
3. **不抄原题**：可与真题同考点，但必须换变形轴(${DEFORM_AXES.join('/')})
4. **优先使用未用轴**：${remainingAxes.slice(0, 4).join('、') || '全部轴可复用'}
5. **已用轴**：${usedAxesList.join('、') || '无'}——本轮必须换轴
6. **每道计算题答案先设计再反向构造题面**，保证答案整齐、可验算
7. **使用 \\score{n} 命令标注每题/每步分值**

## 输出包含
- \\section*{试题} — 试卷抬头 + 全部试题
- \\section*{参考答案与评分标准} — 每题详细解答 + 分步评分($\\score{n}$)
- 命题说明(考点覆盖/难度构成/变形手法)`;
}

function buildUserPrompt(
  setIndex: number, nSets: number, course: string,
  difficulty: DifficultyRatio,
  blueprint: string, template: string, difficultyData: string,
  texSources: Array<typeof schema.projectFiles.$inferSelect>,
  ledger: LedgerEntry[]
): string {
  return `请生成第${setIndex}/${nSets}套《${course}》期末模拟试卷。

${template ? '## 试卷模板\n```\n' + template.slice(0, 3000) + '\n```\n' : ''}
${blueprint ? '## 双向细目表\n```\n' + blueprint.slice(0, 3000) + '\n```\n' : ''}
${difficultyData ? '## 难度核算\n```json\n' + difficultyData.slice(0, 1500) + '\n```\n' : ''}
${texSources.length > 0 ? '## 真题参考（风格对齐）\n' + texSources.slice(0, 1).map(f => {
  try { return readFileSync(f.filepath, 'utf-8').slice(0, 2000); } catch { return ''; }
}).join('\n') : ''}

## 防重台账(已用形态，必须避开)
${ledger.length > 0 ? ledger.map(e => `- 套${e.setIndex} ${e.slotType}: ${e.kp}→${e.axis}→${e.pattern} (数据:${e.keyData})`).join('\n') : '无——这是第1套'}

## 难度目标
- 基础${difficulty.basic}% = ${Math.round(difficulty.basic)}分
- 中等${difficulty.medium}% = ${Math.round(difficulty.medium)}分
- 难${difficulty.hard}% = ${Math.round(difficulty.hard)}分

请输出完整LaTeX代码。`;
}

// ====== Verification ======
async function runVerification(
  projectId: number, setIndex: number,
  texContent: string, course: string
): Promise<{ total: number; passed: number }> {
  addEvent(projectId, 'step-5', 'log', `  🔍 正在验算第${setIndex}套...`);

  if (!isConfigured()) return { total: 0, passed: 0 };

  try {
    const verifyPrompt = `请逐题验算以下《${course}》试卷的答案。对每道题：
1. 判断答案是否正确（PASS/FAIL）
2. 如果FAIL，指出错误并给出修正

试卷LaTeX:
${texContent.slice(0, 8000)}

最后输出总结: TOTAL: N/N checks`;

    const response = await sendMessage(
      '你是学科验算员。逐题验算，严格判定。',
      [{ role: 'user', content: verifyPrompt }],
      { maxTokens: 4000 }
    );

    const totalMatch = response.match(/TOTAL:\s*(\d+)\/(\d+)/);
    if (totalMatch) {
      return { total: Number(totalMatch[2]), passed: Number(totalMatch[1]) };
    }

    // Count PASS lines
    const passCount = (response.match(/PASS/g) || []).length;
    const failCount = (response.match(/FAIL/g) || []).length;
    return { total: passCount + failCount, passed: passCount };
  } catch {
    return { total: 0, passed: 0 };
  }
}

async function qualityReview(
  projectId: number, setIndex: number,
  texContent: string, blueprint: string, template: string, course: string
): Promise<void> {
  if (!isConfigured() || texContent.length < 500) return;

  try {
    const reviewPrompt = `请快速审核这套《${course}》试卷（第${setIndex}套）：

## 核对清单(逐条回复PASS或FAIL+原因)
1. 题型/题量/分值与模板一致？
2. 每题答案正确且步骤完整？
3. \score{} 分值标注完整且合计=总分？
4. 难度分布符合目标？
5. 题目不超纲不偏怪？

试卷LaTeX:
${texContent.slice(0, 6000)}

最后输出一行: REVIEW: PASS 或 REVIEW: ISSUES_FOUND`;

    const response = await sendMessage(
      '你是试卷质量审核员。快速审核，发现真问题才报。',
      [{ role: 'user', content: reviewPrompt }],
      { maxTokens: 2000 }
    );

    if (response.includes('REVIEW: PASS')) {
      // Save review notes
      const reviewPath = join(getProjectDir(projectId), 'papers', `paper-${setIndex}.review.md`);
      writeFileSync(reviewPath, response, 'utf-8');
    }
  } catch {
    // Non-critical, skip quietly
  }
}

// ====== Ledger Management ======
function loadLedger(path: string): LedgerEntry[] {
  try {
    const content = readFileSync(path, 'utf-8');
    const entries: LedgerEntry[] = [];
    for (const line of content.split('\n')) {
      if (line.startsWith('|') && !line.startsWith('| 套')) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 6) {
          entries.push({
            setIndex: Number(cols[0]),
            slotType: cols[1],
            slotIndex: Number(cols[2]) || 0,
            kp: cols[3],
            axis: cols[4],
            pattern: cols[5],
            keyData: cols[6] || '',
          });
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function saveLedger(path: string, entries: LedgerEntry[]): void {
  const lines = ['# 防重台账', '', '| 套 | 题位 | 序号 | 考点 | 变形轴 | 设问范式 | 关键数据 |', '|-----|------|------|------|--------|----------|----------|'];
  for (const e of entries) {
    lines.push(`| ${e.setIndex} | ${e.slotType} | ${e.slotIndex} | ${e.kp} | ${e.axis} | ${e.pattern} | ${e.keyData} |`);
  }
  writeFileSync(path, lines.join('\n'), 'utf-8');
}

function extractLedgerEntries(texContent: string, setIndex: number): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  // Extract scored items and their question patterns
  const scoreRe = /\\score\{(\d+(?:\.\d+)?)\}/g;
  const matches = [...texContent.matchAll(scoreRe)];

  // Extract question stems near each score
  const lines = texContent.split('\n');
  let qNum = 0;

  for (const match of matches) {
    qNum++;
    // Find the nearest preceding descriptive line
    const lineIdx = texContent.slice(0, match.index!).split('\n').length - 1;
    const context = lines.slice(Math.max(0, lineIdx - 3), lineIdx + 1).join(' ').slice(0, 200);

    // Detect deformation axis from context hints
    const axis = detectAxis(context);

    entries.push({
      setIndex,
      slotType: detectType(context),
      slotIndex: qNum,
      kp: extractKp(context),
      axis,
      pattern: context.slice(0, 80).replace(/\|/g, '/'),
      keyData: String(match[1]) + '分',
    });
  }

  return entries;
}

function detectAxis(context: string): string {
  if (context.includes('证明') || context.includes('求证')) return '②任务类型(证明)';
  if (context.includes('判断') || context.includes('改错')) return '②任务类型(判断)';
  if (context.includes('参数') || context.includes('讨论')) return '⑤含参化';
  if (context.includes('综合') || context.includes('结合')) return '⑥综合';
  if (context.includes('应用') || context.includes('实际')) return '⑦情境';
  if (context.includes('设') && context.includes('求')) return '①正↔逆(反求)';
  if (context.includes('举例') || context.includes('反例')) return '②任务类型(举例)';
  return DEFORM_AXES[Math.floor(Math.random() * 3)]; // 正逆/表征/抽象
}

function detectType(context: string): string {
  const types = ['选择题', '填空题', '计算题', '证明题', '简答题', '判断题'];
  for (const t of types) {
    if (context.includes(t)) return t;
  }
  return '未知';
}

function extractKp(context: string): string {
  const kpPatterns = ['极限', '导数', '积分', '行列式', '矩阵', '方程', '向量', '级数', '概率', '统计'];
  for (const p of kpPatterns) {
    if (context.includes(p)) return p;
  }
  return '待分类';
}

function usedAxes(ledger: LedgerEntry[]): string[] {
  return [...new Set(ledger.map(e => e.axis.slice(0, 2)))];
}

// ====== Helpers ======
function extractLatexBody(response: string): string {
  const docBegin = response.search(/\\begin\{document\}/);
  const docEnd = response.search(/\\end\{document\}/);
  if (docBegin !== -1 && docEnd !== -1) {
    return response.slice(docBegin + 16, docEnd).trim();
  }
  // Try code block extraction
  const codeBlockMatch = response.match(/```(?:latex)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].replace(/^latex\n/, '').trim();
  }
  return response;
}

const PREAMBLE = [
  '% !TEX program = xelatex',
  '\\documentclass[UTF8,a4paper,11pt]{ctexart}',
  '\\usepackage{amsmath,amssymb,bm}',
  '\\usepackage{geometry,enumitem,booktabs,extarrows}',
  '\\geometry{left=20mm,right=20mm,top=22mm,bottom=22mm}',
  '\\setlength{\\parindent}{2em}',
  '\\DeclareMathOperator{\\rank}{rank}',
  '\\newcommand{\\score}[1]{\\hfill\\mbox{\\bfseries（#1分）}}',
  '\\allowdisplaybreaks',
].join('\n');

function wrapInDocument(body: string): string {
  return PREAMBLE + '\n\\begin{document}\n\n' + body + '\n\n\\end{document}';
}

function readStepFile(projectId: number, type: string): string {
  const files = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .where(eq(schema.projectFiles.type, type))
    .all();

  return files.map(f => {
    try {
      const content = readFileSync(f.filepath, 'utf-8');
      return `## ${f.filename}\n${content}`;
    } catch {
      return '';
    }
  }).join('\n\n');
}

function readFileIfExists(path: string): string {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}
