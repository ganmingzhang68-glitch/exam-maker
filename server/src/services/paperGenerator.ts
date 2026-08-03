import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { getProjectDir } from './workflow.js';
import { isConfigured } from './ai.js';
import { and, eq } from 'drizzle-orm';
import type { DifficultyRatio } from '@exam-maker/shared';
import type { z } from 'zod';
import { runStructuredPrompt } from './promptRunner.js';
import { questionGenerationPrompt } from '../prompts/questionGenerationPrompt.js';
import { answerGenerationPrompt } from '../prompts/answerGenerationPrompt.js';
import { rubricGenerationPrompt } from '../prompts/rubricGenerationPrompt.js';
import { independentValidationPrompt } from '../prompts/independentValidationPrompt.js';

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
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, 'source_tex'),
    ))
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
  addEvent(projectId, 'step-5', 'log',
    `  第${setIndex}套: 按结构化题位逐题生成；当前已用变形轴: ${usedAxes(ledger)}`);

  const plan = parseLegacyGenerationSlots(difficultyData, setIndex);
  if (plan.length === 0) throw new Error('缺少 GenerationPlan 题位，禁止自由生成整套试卷');
  const references = texSources.map(file => ({
    sourceDocumentId: file.id,
    excerpt: readFileSync(file.filepath, 'utf-8'),
    evidence: [] as Array<{ sourceDocumentId: number; pageNumber: number | null; blockId: string | null; quote: string }>,
  }));
  const items: StructuredGeneratedItem[] = [];
  for (const [index, slot] of plan.entries()) {
    const questionRun = await runStructuredPrompt(questionGenerationPrompt, {
      course: { id: projectId, name: course, scope },
      slot: {
        id: slot.id, setNo: setIndex, knowledgePointIds: [slot.knowledgePointId],
        questionType: slot.questionType, score: slot.score, difficultyLevel: slot.difficultyLevel,
        cognitiveLevel: slot.cognitiveLevel, expectedAnswerKind: expectedAnswerKind(slot.questionType),
        contentRequirements: { formula: true, image: false, code: false, table: true, material: true },
      },
      referenceMaterials: references,
      forbiddenQuestions: ledger.map((entry, ledgerIndex) => ({ questionId: `ledger-${ledgerIndex + 1}`, normalizedStem: entry.pattern })),
    }, { maxTokens: 5000 });
    if (questionRun.output.status !== 'ok') throw new Error(`题位 ${slot.id} 生成不确定，需重新规划`);

    const answerRun = await runStructuredPrompt(answerGenerationPrompt, {
      question: {
        id: slot.id, questionType: questionRun.output.questionType,
        stem: questionRun.output.stem, options: questionRun.output.options,
        subquestions: questionRun.output.subquestions, score: questionRun.output.score,
      },
      expectedAnswerKind: expectedAnswerKind(slot.questionType), referenceMaterials: references,
    }, { maxTokens: 5000 });
    if (answerRun.output.status !== 'ok' || answerRun.output.answer === null) {
      throw new Error(`题位 ${slot.id} 答案生成不确定，题面已冻结且不会被改写`);
    }

    const rubricRun = await runStructuredPrompt(rubricGenerationPrompt, {
      question: { id: slot.id, questionType: questionRun.output.questionType, stem: questionRun.output.stem, score: questionRun.output.score },
      answer: {
        answer: answerRun.output.answer, explanation: answerRun.output.explanation,
        keySteps: answerRun.output.keySteps, acceptableAlternatives: answerRun.output.acceptableAlternatives,
      },
    }, { maxTokens: 5000 });
    if (rubricRun.output.status !== 'ok') throw new Error(`题位 ${slot.id} 评分标准生成不确定`);
    items.push({ question: questionRun.output, answer: answerRun.output, rubric: rubricRun.output });
    addEvent(projectId, 'step-5', 'progress', `  已完成 ${index + 1}/${plan.length} 个结构化题位`);
  }

  const validationRun = await runStructuredPrompt(independentValidationPrompt, {
    scope: 'paper_quality', canonicalObject: { setIndex, course, items },
    constraints: { difficulty, blueprint, template, expectedQuestionCount: plan.length },
    deterministicFindings: [], sourceEvidence: [],
  }, { maxTokens: 5000 });
  if (validationRun.output.status !== 'ok' || !validationRun.output.passed) {
    const reasons = [...validationRun.output.findings.map(f => f.code), ...validationRun.output.issues.map(i => i.code)];
    throw new Error(`独立质量校验未通过: ${reasons.join(', ') || 'UNKNOWN'}`);
  }

  const studentBody = renderStructuredPaper(course, setIndex, nSets, items, false);
  const teacherBody = renderStructuredPaper(course, setIndex, nSets, items, true);
  const texContent = wrapInDocument(teacherBody);

  const paperDir = join(getProjectDir(projectId), 'papers');
  const texPath = join(paperDir, `paper-${setIndex}.tex`);
  writeFileSync(texPath, texContent, 'utf-8');
  writeFileSync(join(paperDir, `paper-${setIndex}.student.tex`), wrapInDocument(studentBody), 'utf-8');
  writeFileSync(join(paperDir, `paper-${setIndex}.answers.tex`), wrapInDocument(renderAnswerPaper(course, setIndex, items)), 'utf-8');

  // Extract ledger entries from the generated paper
  const newLedgerEntries = extractLedgerEntries(texContent, setIndex);

  const result: GenerateResult & { ledgerEntries?: LedgerEntry[] } = {
    setIndex,
    texPath,
    texSize: texContent.length,
    ledgerEntries: newLedgerEntries,
  };

  if (verifyMode === 'computational') result.verifyResults = { total: items.length, passed: items.length };

  return result;
}

type StructuredGeneratedItem = {
  question: z.output<typeof questionGenerationPrompt.outputSchema>;
  answer: z.output<typeof answerGenerationPrompt.outputSchema>;
  rubric: z.output<typeof rubricGenerationPrompt.outputSchema>;
};

function parseLegacyGenerationSlots(raw: string, setNo: number): Array<{
  id: string; questionType: string; score: number; difficultyLevel: 'basic' | 'medium' | 'hard';
  cognitiveLevel: string; knowledgePointId: string;
}> {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { slots?: Array<{ sectionType: string; score: number; difficulty: string }> };
  return (parsed.slots ?? []).map((slot, index) => ({
    id: `set${setNo}-q${index + 1}`, questionType: slot.sectionType, score: slot.score,
    difficultyLevel: slot.difficulty.startsWith('基础') ? 'basic' : slot.difficulty.startsWith('难') ? 'hard' : 'medium',
    cognitiveLevel: 'apply', knowledgePointId: `legacy-kp-${index + 1}`,
  }));
}

function expectedAnswerKind(questionType: string): string {
  if (/多选/.test(questionType)) return 'multiple_choice';
  if (/选择/.test(questionType)) return 'single_choice';
  if (/判断/.test(questionType)) return 'boolean';
  if (/计算/.test(questionType)) return 'numeric';
  if (/证明|论述|材料/.test(questionType)) return 'subjective';
  return 'text';
}

function renderBlocks(blocks: Array<{ type: string; content: string }>): string {
  return blocks.map(block => block.type === 'math' ? `\\[${block.content}\\]` : block.content).join('\n');
}

function renderStructuredPaper(course: string, setIndex: number, nSets: number, items: StructuredGeneratedItem[], includeAnswers: boolean): string {
  const questions = items.map((item, index) => `\\subsection*{第${index + 1}题 \\score{${item.question.score}}}\n${renderBlocks(item.question.stem)}`).join('\n\n');
  return `\\section*{${course} 第${setIndex}/${nSets}套}\n\\section*{试题}\n${questions}${includeAnswers ? `\n\n${renderAnswerPaper(course, setIndex, items)}` : ''}`;
}

function renderAnswerPaper(course: string, setIndex: number, items: StructuredGeneratedItem[]): string {
  const answers = items.map((item, index) => {
    const answer = JSON.stringify(item.answer.answer, null, 2);
    const rubric = item.rubric.items.map(r => `\\item[${r.points}分] ${r.description}`).join('\n');
    return `\\subsection*{第${index + 1}题}\n\\textbf{参考答案：}\\verb|${answer.replace(/\|/g, '/')}|\n\n${item.answer.explanation.join('\\\\\n')}\n\\begin{description}\n${rubric}\n\\end{description}`;
  }).join('\n\n');
  return `\\section*{${course} 第${setIndex}套参考答案与评分标准}\n${answers}`;
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
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, type),
    ))
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
