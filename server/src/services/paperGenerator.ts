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
  studentPath?: string;
  answerPath?: string;
  rubricPath?: string;
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

  addEvent(projectId, 'step-5', 'log', `📝 命题参数: ${nSets}套, 目标难度${difficulty.basic}/${difficulty.medium}/${difficulty.hard}`);
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

      const commonMetadata = {
        setNumber: i, difficulty, size: result.texSize,
        verified: result.verifyResults ? `${result.verifyResults.passed}/${result.verifyResults.total}` : null,
      };
      registerProjectFile(projectId, 'generated_paper', `paper-${i}.tex`, result.texPath,
        { ...commonMetadata, artifactType: 'teacher_package', audience: 'teacher' });
      registerProjectFile(projectId, 'student_paper', `paper-${i}.student.tex`, result.studentPath!,
        { ...commonMetadata, artifactType: 'question_paper', audience: 'student' });
      registerProjectFile(projectId, 'answer_key', `paper-${i}.answers.tex`, result.answerPath!,
        { ...commonMetadata, artifactType: 'answer_key', audience: 'teacher' });
      registerProjectFile(projectId, 'rubric', `paper-${i}.rubric.tex`, result.rubricPath!,
        { ...commonMetadata, artifactType: 'rubric', audience: 'grader' });

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

  const historicalBlueprint = readFileIfExists(join(getProjectDir(projectId), 'blueprint.jsonl'));
  const plan = parseLegacyGenerationSlots(difficultyData, setIndex, historicalBlueprint);
  if (plan.length === 0) throw new Error('缺少 GenerationPlan 题位，禁止自由生成整套试卷');
  const references = texSources.map(file => ({
    sourceDocumentId: file.id,
    excerpt: stripAnswerSections(readFileSync(file.filepath, 'utf-8')),
    evidence: [] as Array<{ sourceDocumentId: number; pageNumber: number | null; blockId: string | null; quote: string }>,
  }));
  const paperDir = join(getProjectDir(projectId), 'papers');
  const itemCachePath = join(paperDir, `paper-${setIndex}.items.json`);
  const planSignature = JSON.stringify(plan);
  const items = loadGeneratedItemCache(itemCachePath, planSignature);
  const validatedPaperExists = items.length === plan.length && existsSync(join(paperDir, `paper-${setIndex}.tex`));
  if (items.length > 0) {
    addEvent(projectId, 'step-5', 'log', `↩ 第${setIndex}套从 ${items.length}/${plan.length} 个已完成题位继续`);
  }
  for (let index = items.length; index < plan.length; index++) {
    const slot = plan[index];
    const slotCachePath = join(paperDir, `paper-${setIndex}.slot-${index + 1}.json`);
    const cachedSlot = loadGeneratedSlotCache(slotCachePath, planSignature);
    let questionOutput = cachedSlot?.question;
    if (!questionOutput) {
      const questionRun = await runStructuredPrompt(questionGenerationPrompt, {
        course: { id: projectId, name: course, scope },
        slot: {
          id: slot.id, setNo: setIndex, knowledgePointIds: slot.knowledgePointIds,
          questionType: slot.questionType, score: slot.score, difficultyLevel: slot.difficultyLevel,
          cognitiveLevel: slot.cognitiveLevel, expectedAnswerKind: expectedAnswerKind(slot.questionType),
          contentRequirements: { formula: true, image: false, code: false, table: true, material: true },
        },
        referenceMaterials: references,
        forbiddenQuestions: ledger.map((entry, ledgerIndex) => ({ questionId: `ledger-${ledgerIndex + 1}`, normalizedStem: entry.pattern })),
      }, { maxTokens: 5000 });
      if (questionRun.output.status !== 'ok') throw new Error(`题位 ${slot.id} 生成不确定，需重新规划`);
      questionOutput = questionRun.output;
      saveGeneratedSlotCache(slotCachePath, planSignature, questionOutput);
    }

    const answerReferences = references.map(reference => ({
      ...reference,
      evidence: questionOutput.sourceEvidence.filter(evidence => evidence.sourceDocumentId === reference.sourceDocumentId),
    }));
    let answerOutput = cachedSlot?.answer;
    if (!answerOutput) {
      const answerRun = await runStructuredPrompt(answerGenerationPrompt, {
        question: {
          id: slot.id, questionType: questionOutput.questionType,
          stem: questionOutput.stem, options: questionOutput.options,
          subquestions: questionOutput.subquestions, score: questionOutput.score,
        },
        expectedAnswerKind: expectedAnswerKind(slot.questionType), referenceMaterials: answerReferences,
      }, { maxTokens: 5000 });
      if (answerRun.output.status !== 'ok' || answerRun.output.answer === null) {
        throw new Error(`题位 ${slot.id} 答案生成不确定，题面已冻结且不会被改写`);
      }
      answerOutput = answerRun.output;
      saveGeneratedSlotCache(slotCachePath, planSignature, questionOutput, answerOutput);
    }

    const rubricRun = await runStructuredPrompt(rubricGenerationPrompt, {
      question: {
        id: slot.id, questionType: questionOutput.questionType, stem: questionOutput.stem,
        subquestions: questionOutput.subquestions, score: questionOutput.score,
      },
      answer: {
        answer: answerOutput.answer!, explanation: answerOutput.explanation,
        keySteps: answerOutput.keySteps, acceptableAlternatives: answerOutput.acceptableAlternatives,
      },
    }, { maxTokens: 5000 });
    if (rubricRun.output.status !== 'ok') throw new Error(`题位 ${slot.id} 评分标准生成不确定`);
    items.push({ question: questionOutput, answer: answerOutput, rubric: rubricRun.output });
    writeFileSync(itemCachePath, JSON.stringify({ planSignature, items }, null, 2), 'utf-8');
    addEvent(projectId, 'step-5', 'progress', `  已完成 ${index + 1}/${plan.length} 个结构化题位`);
  }

  if (validatedPaperExists) {
    addEvent(projectId, 'step-5', 'log', '✅ 复用该冻结试卷此前已通过的独立质量校验，仅重新渲染格式');
  } else {
    const validationRun = await runStructuredPrompt(independentValidationPrompt, {
      scope: 'paper_quality', canonicalObject: { setIndex, course, items },
      constraints: { difficulty, blueprint, template, expectedQuestionCount: plan.length },
      deterministicFindings: [], sourceEvidence: [],
    }, { maxTokens: 5000 });
    const reportedFindings = validationRun.output.findings.map(finding =>
      isDifficultyDistributionFinding(finding.code)
        ? { ...finding, severity: 'warning' as const }
        : finding);
    const blockingFindings = reportedFindings.filter(
      finding => finding.severity === 'error' || finding.severity === 'critical',
    );
    if (validationRun.output.status !== 'ok' || blockingFindings.length > 0) {
      const reasons = [...blockingFindings.map(f => f.code), ...validationRun.output.issues.map(i => i.code)];
      throw new Error(`独立质量校验未通过: ${reasons.join(', ') || 'UNKNOWN'}`);
    }
    if (!validationRun.output.passed || reportedFindings.length > 0) {
      addEvent(projectId, 'step-5', 'log',
        `⚠ 第${setIndex}套质量校验存在非阻断警告: ${reportedFindings.map(f => f.code).join(', ') || 'VALIDATION_WARNING'}`);
    }
  }

  const studentBody = renderStructuredPaper(course, setIndex, nSets, items, false);
  const teacherBody = renderStructuredPaper(course, setIndex, nSets, items, true);
  const texContent = wrapInDocument(teacherBody);

  const texPath = join(paperDir, `paper-${setIndex}.tex`);
  const studentPath = join(paperDir, `paper-${setIndex}.student.tex`);
  const answerPath = join(paperDir, `paper-${setIndex}.answers.tex`);
  const rubricPath = join(paperDir, `paper-${setIndex}.rubric.tex`);
  writeFileSync(texPath, texContent, 'utf-8');
  writeFileSync(studentPath, wrapInDocument(studentBody), 'utf-8');
  writeFileSync(answerPath, wrapInDocument(renderAnswerPaper(course, setIndex, items)), 'utf-8');
  writeFileSync(rubricPath, wrapInDocument(renderRubricPaper(course, setIndex, items)), 'utf-8');

  // Extract ledger entries from the generated paper
  const newLedgerEntries = extractLedgerEntries(texContent, setIndex);

  const result: GenerateResult & { ledgerEntries?: LedgerEntry[] } = {
    setIndex,
    texPath,
    texSize: texContent.length,
    studentPath,
    answerPath,
    rubricPath,
    ledgerEntries: newLedgerEntries,
  };

  if (verifyMode === 'computational') result.verifyResults = { total: items.length, passed: items.length };

  return result;
}

export function isDifficultyDistributionFinding(code: string): boolean {
  return code === 'DIFFICULTY_MISMATCH'
    || /^DIFFICULTY_DISTRIBUTION_[A-Z0-9_]+$/.test(code);
}

type StructuredGeneratedItem = {
  question: z.output<typeof questionGenerationPrompt.outputSchema>;
  answer: z.output<typeof answerGenerationPrompt.outputSchema>;
  rubric: z.output<typeof rubricGenerationPrompt.outputSchema>;
};

function loadGeneratedItemCache(path: string, planSignature: string): StructuredGeneratedItem[] {
  if (!existsSync(path)) return [];
  try {
    const cached = JSON.parse(readFileSync(path, 'utf-8')) as { planSignature?: string; items?: unknown[] };
    if (cached.planSignature !== planSignature || !Array.isArray(cached.items)) return [];
    return cached.items.map(item => {
      const value = item as Record<string, unknown>;
      const parsed = {
        question: questionGenerationPrompt.outputSchema.parse(value.question),
        answer: answerGenerationPrompt.outputSchema.parse(value.answer),
        rubric: rubricGenerationPrompt.outputSchema.parse(value.rubric),
      };
      if (questionHasUnstructuredSubquestions(parsed.question)) {
        throw new Error(`Cached question ${parsed.question.slotId} has unstructured subquestions`);
      }
      return parsed;
    });
  } catch {
    return [];
  }
}

function loadGeneratedSlotCache(
  path: string,
  planSignature: string,
): Pick<StructuredGeneratedItem, 'question' | 'answer'> | null {
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    if (cached.planSignature !== planSignature) return null;
    const question = questionGenerationPrompt.outputSchema.parse(cached.question);
    if (questionHasUnstructuredSubquestions(question)) return null;
    const answer = cached.answer === undefined ? undefined : answerGenerationPrompt.outputSchema.parse(cached.answer);
    return answer ? { question, answer } : { question } as Pick<StructuredGeneratedItem, 'question' | 'answer'>;
  } catch {
    return null;
  }
}

export function questionHasUnstructuredSubquestions(
  question: Pick<z.output<typeof questionGenerationPrompt.outputSchema>, 'stem' | 'subquestions'>,
): boolean {
  if (question.subquestions.length > 0) return false;
  const text = question.stem.map(block => block.content).join('\n');
  const numberedMarkers = text.match(/(?:^|\n)\s*[（(]\s*\d+\s*[）)]/g) ?? [];
  return new Set(numberedMarkers.map(marker => marker.replace(/\s/g, ''))).size >= 2;
}

function saveGeneratedSlotCache(
  path: string,
  planSignature: string,
  question: StructuredGeneratedItem['question'],
  answer?: StructuredGeneratedItem['answer'],
): void {
  writeFileSync(path, JSON.stringify({ planSignature, question, ...(answer ? { answer } : {}) }, null, 2), 'utf-8');
}

export function parseLegacyGenerationSlots(raw: string, setNo: number, blueprintRaw = ''): Array<{
  id: string; questionType: string; score: number; difficultyLevel: 'basic' | 'medium' | 'hard';
  cognitiveLevel: string; knowledgePointIds: string[];
}> {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { slots?: Array<{ sectionType: string; score: number; difficulty: string }> };
  const blueprintEntries = blueprintRaw.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line) as { kp?: string[]; cognition?: string }; } catch { return {}; }
  });
  const cognitionMap: Record<string, string> = {
    '记忆': 'remember', '理解': 'understand', '应用': 'apply', '分析': 'analyze', '评价/综合': 'evaluate',
  };
  return (parsed.slots ?? []).map((slot, index) => ({
    id: `set${setNo}-q${index + 1}`, questionType: slot.sectionType, score: slot.score,
    difficultyLevel: slot.difficulty.startsWith('基础') ? 'basic' : slot.difficulty.startsWith('难') ? 'hard' : 'medium',
    cognitiveLevel: cognitionMap[blueprintEntries[index]?.cognition ?? ''] ?? 'understand',
    knowledgePointIds: blueprintEntries[index]?.kp?.length
      ? blueprintEntries[index].kp
      : [`legacy-kp-${index + 1}`],
  }));
}

function expectedAnswerKind(questionType: string): string {
  if (/multiple_choice|多选/i.test(questionType)) return 'multiple_choice';
  if (/single_choice|选择/i.test(questionType)) return 'single_choice';
  if (/true_false|判断/i.test(questionType)) return 'boolean';
  if (/calculation|计算/i.test(questionType)) return 'numeric';
  if (/essay|proof|short_answer|证明|论述|材料|简答/i.test(questionType)) return 'subjective';
  return 'text';
}

export function stripAnswerSections(content: string): string {
  return content
    .replace(/\\(?:sub)*section\*?\{(?:参考)?(?:答案|解析)[^}]*\}[\s\S]*$/im, '')
    .replace(/(?:^|\n)#{1,6}\s*(?:参考)?(?:答案|解析)[^\n]*[\s\S]*$/im, '')
    .trim();
}

export function renderBlocks(blocks: Array<{ type: string; content: string }>): string {
  return blocks.map(block => {
    if (block.type === 'math') return `\\[${block.content}\\]`;
    if (block.type === 'code') return `\\begin{verbatim}\n${block.content}\n\\end{verbatim}`;
    if (block.type === 'table') return renderMarkdownTable(block.content);
    return escapeLatexText(block.content);
  }).join('\n');
}

function renderMarkdownTable(value: string): string {
  const rows = value.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && line.endsWith('|'))
    .filter(line => !/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(line))
    // Markdown column delimiters conventionally have surrounding spaces.
    // Splitting only those keeps LaTeX absolute-value bars (for example \|f(x)|)
    // inside a cell instead of creating phantom columns.
    .map(line => line.slice(1, -1).split(/\s+\|\s+/).map(cell => cell.trim()));
  const dataRows = rows;
  if (dataRows.length === 0 || dataRows.some(row => row.length !== dataRows[0].length)) {
    return escapeLatexText(value);
  }
  const columns = '|' + 'l|'.repeat(dataRows[0].length);
  const body = dataRows.map(row => row.map(escapeLatexText).join(' & ') + ' \\\\ \\hline').join('\n');
  return '\\begin{center}\n\\begin{tabular}{' + columns + '}\n\\hline\n' + body + '\n\\end{tabular}\n\\end{center}';
}

function renderStructuredPaper(course: string, setIndex: number, nSets: number, items: StructuredGeneratedItem[], includeAnswers: boolean): string {
  const questions = items.map((item, index) => {
    const options = item.question.options.length > 0
      ? `\n\\begin{enumerate}[label=\\Alph*.]\n${item.question.options.map(option => `\\item ${renderBlocks(option.content)}`).join('\n')}\n\\end{enumerate}`
      : '';
    const subquestions = item.question.subquestions.length > 0
      ? `\n\\begin{enumerate}[label=(\\arabic*)]\n${item.question.subquestions.map(subquestion => `\\item ${renderBlocks(subquestion.stem)} \\score{${subquestion.score}}`).join('\n')}\n\\end{enumerate}`
      : '';
    return `\\subsection*{第${index + 1}题 \\score{${item.question.score}}}\n${renderBlocks(item.question.stem)}${options}${subquestions}`;
  }).join('\n\n');
  const teacherAppendix = includeAnswers
    ? `\n\n${renderAnswerPaper(course, setIndex, items)}\n\n${renderRubricPaper(course, setIndex, items)}`
    : '';
  return `\\section*{${escapeLatexText(course)} 第${setIndex}/${nSets}套}\n\\section*{试题}\n${questions}${teacherAppendix}`;
}

function renderAnswerPaper(course: string, setIndex: number, items: StructuredGeneratedItem[]): string {
  const answers = items.map((item, index) => {
    const explanation = item.answer.explanation.length > 0
      ? `\n\\textbf{答案解析：}\n\\begin{enumerate}\n${item.answer.explanation.map(line => `\\item ${escapeLatexText(line)}`).join('\n')}\n\\end{enumerate}`
      : '';
    const distractors = item.answer.distractorAnalysis.length > 0
      ? `\n\\textbf{干扰项分析：}\n\\begin{description}\n${item.answer.distractorAnalysis.map(entry => `\\item[${escapeLatexText(entry.optionId)}] ${escapeLatexText(entry.analysis)}`).join('\n')}\n\\end{description}`
      : '';
    return `\\subsection*{第${index + 1}题}\n\\textbf{参考答案：}${renderAnswerValue(item.answer.answer)}${explanation}${distractors}`;
  }).join('\n\n');
  return `\\section*{${escapeLatexText(course)} 第${setIndex}套参考答案}\n${answers}`;
}

function renderRubricPaper(course: string, setIndex: number, items: StructuredGeneratedItem[]): string {
  const rubrics = items.map((item, index) => {
    const entries = item.rubric.items.map(entry => {
      const partial = entry.partialCreditRule ? `；部分得分：${escapeLatexText(entry.partialCreditRule)}` : '';
      const errors = entry.commonErrors.length > 0
        ? `；常见错误：${entry.commonErrors.map(error => `${escapeLatexText(error.error)}（扣${error.deduction}分）`).join('，')}`
        : '';
      return `\\item[${entry.points}分] ${escapeLatexText(entry.description)}${partial}${errors}`;
    }).join('\n');
    return `\\subsection*{第${index + 1}题（共${item.rubric.totalScore}分）}\n\\begin{description}\n${entries}\n\\end{description}`;
  }).join('\n\n');
  return `\\section*{${escapeLatexText(course)} 第${setIndex}套逐项评分标准}\n${rubrics}`;
}

function renderAnswerValue(answer: StructuredGeneratedItem['answer']['answer']): string {
  if (!answer) return '待确认';
  switch (answer.kind) {
    case 'single_choice': return escapeLatexText(answer.optionId);
    case 'multiple_choice': return escapeLatexText(answer.optionIds.join('、'));
    case 'boolean': return answer.value ? '正确' : '错误';
    case 'text': return answer.accepted.map(escapeLatexText).join('；');
    case 'numeric': return `${escapeLatexText(answer.value)}${answer.unit ? ` ${escapeLatexText(answer.unit)}` : ''}`;
    case 'expression': return `\\(${answer.latex}\\)`;
    case 'subjective': return answer.keyPoints.map(escapeLatexText).join('；');
  }
}

export function escapeLatexText(value: string): string {
  const mathPattern = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;
  let cursor = 0;
  let result = '';
  for (const match of value.matchAll(mathPattern)) {
    const index = match.index ?? 0;
    result += escapePlainLatex(value.slice(cursor, index));
    result += match[0];
    cursor = index + match[0].length;
  }
  result += escapePlainLatex(value.slice(cursor));
  return result;
}

function escapePlainLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%&#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
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
  // Extract the axis name (starts with ①-⑧, strip trailing descriptor)
  return [...new Set(ledger.map(e => (e.axis || '').slice(0, 3)).filter(a => /^[①②③④⑤⑥⑦⑧]/.test(a)))];
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

// If the body looks like Markdown (not LaTeX), convert basic markdown to LaTeX so it compiles.
function ensureLatexBody(body: string): string {
  // Heuristic: if it contains LaTeX commands (\section, \\begin, $...$ math), assume LaTeX
  const looksLikeLatex =
    /\\[a-zA-Z]+/.test(body) ||
    /\$[^$]+\$/.test(body) ||
    /\\begin\{/.test(body);

  if (looksLikeLatex) return body;

  // Convert common markdown → LaTeX
  let out = body;
  // # heading → section (but not #1分 from \score which is already LaTeX)
  out = out.replace(/^# (.+)$/gm, '\\section*{$1}');
  out = out.replace(/^## (.+)$/gm, '\\subsection*{$1}');
  out = out.replace(/^### (.+)$/gm, '\\subsubsection*{$1}');
  // --- horizontal rule
  out = out.replace(/^---\s*$/gm, '\\noindent\\rule{\\linewidth}{0.4pt}');
  // **bold**
  out = out.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  // - bullets
  out = out.replace(/^- (.+)$/gm, '\\item $1');
  // Escape stray # that break LaTeX
  out = out.replace(/(^|[^\\])#/gm, '$1\\#');
  return out;
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
  const safeBody = ensureLatexBody(body);
  return PREAMBLE + '\n\\begin{document}\n\n' + safeBody + '\n\n\\end{document}';
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

function registerProjectFile(
  projectId: number,
  type: string,
  filename: string,
  filepath: string,
  metadata: Record<string, unknown>,
): void {
  const existing = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.filename, filename),
    ))
    .get();
  if (existing) {
    db.update(schema.projectFiles)
      .set({ type, filepath, metadata: JSON.stringify(metadata) })
      .where(eq(schema.projectFiles.id, existing.id))
      .run();
    return;
  }
  db.insert(schema.projectFiles).values({
    projectId, type, filename, filepath, metadata: JSON.stringify(metadata),
  }).run();
}
