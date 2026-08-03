import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { isConfigured } from './ai.js';
import { getProjectDir } from './workflow.js';
import { and, eq } from 'drizzle-orm';
import { runStructuredPrompt } from './promptRunner.js';
import { questionParsingPrompt } from '../prompts/questionParsingPrompt.js';
import { templateExtractionPrompt } from '../prompts/templateExtractionPrompt.js';
import { independentValidationPrompt } from '../prompts/independentValidationPrompt.js';

// ====== Types ======
export interface TemplateSection {
  index: number;
  type: string;            // 选择题/填空题/计算题/证明题...
  count: number;           // number of questions
  pointsPerQuestion: number;
  subtotal: number;        // count × pointsPerQuestion
}

export interface TemplateResult {
  course: string;
  totalScore: number;
  duration: number;        // minutes
  sections: TemplateSection[];
  headerStyle: string;     // observed header/instructions patterns
  verified: boolean;
  verifyNotes: string[];
  sourceFiles: string[];   // which source tex files were analyzed
}

// ====== Main Analysis ======
export async function analyzeTemplate(
  projectId: number,
  course: string
): Promise<TemplateResult> {
  const texFiles = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, 'source_tex'),
    ))
    .all();

  if (texFiles.length === 0) {
    addEvent(projectId, 'step-3', 'log', '⚠ 未找到已解析的真题 LaTeX，无法提取模板');
    return buildFallbackTemplate(course);
  }

  addEvent(projectId, 'step-3', 'log', '📐 启动模板提取子代理...');

  if (isConfigured()) {
    return await aiExtractTemplate(projectId, course, texFiles);
  }

  return heuristicExtractTemplate(projectId, course, texFiles);
}

async function aiExtractTemplate(
  projectId: number, course: string,
  texFiles: Array<typeof schema.projectFiles.$inferSelect>
): Promise<TemplateResult> {
  addEvent(projectId, 'step-3', 'log', '🤖 使用 AI 提取试卷结构...');

  try {
    const parsedQuestions: Array<{
      sourceExamId: number; questionNo: string; questionType: string; score: number | null;
      sectionTitle: string | null; evidence: Array<{ sourceDocumentId: number; pageNumber: number | null; blockId: string | null; quote: string }>;
    }> = [];
    const renderingEvidence: Array<{ sourceExamId: number; text: string; evidence: never[] }> = [];
    for (const file of texFiles) {
      const text = readFileSync(file.filepath, 'utf-8');
      const parsedRun = await runStructuredPrompt(questionParsingPrompt, {
        sourceExamId: file.id, sourceDocumentId: file.id,
        questionSections: [{ id: 'legacy-source', pageStart: 1, pageEnd: 1 }],
        pages: [{ pageNumber: 1, text, blockIds: [] }],
      }, { maxTokens: 8000 });
      for (const question of parsedRun.output.questions) {
        parsedQuestions.push({
          sourceExamId: file.id, questionNo: question.originalQuestionNo,
          questionType: question.questionType, score: question.originalScore,
          sectionTitle: null, evidence: question.evidence,
        });
      }
      renderingEvidence.push({ sourceExamId: file.id, text, evidence: [] });
    }
    if (parsedQuestions.length === 0) throw new Error('question_parsing_prompt 未产生可用题目');

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    const extractedRun = await runStructuredPrompt(templateExtractionPrompt, {
      course: { id: project?.courseId ?? projectId, name: course },
      sourceExams: texFiles.map(file => ({ id: file.id, title: file.filename, durationMinutes: null, instructions: [] })),
      questions: parsedQuestions,
      renderingEvidence,
    }, { maxTokens: 5000 });
    const parsed = extractedRun.output;
    if (parsed.status !== 'ok' || parsed.assessmentTemplate.totalScore === null ||
        parsed.assessmentTemplate.durationMinutes === null || parsed.assessmentTemplate.sections.length === 0) {
      throw new Error(`template_extraction_prompt 证据不足: ${parsed.issues.map(issue => issue.code).join(',')}`);
    }

    const result: TemplateResult = {
      course,
      totalScore: parsed.assessmentTemplate.totalScore,
      duration: parsed.assessmentTemplate.durationMinutes,
      sections: parsed.assessmentTemplate.sections.map((s, i) => ({
        index: i + 1,
        type: s.questionType,
        count: s.questionCount,
        pointsPerQuestion: s.scorePerQuestion ?? s.subtotal / s.questionCount,
        subtotal: s.subtotal,
      })),
      headerStyle: JSON.stringify(parsed.renderingTemplate),
      verified: false,
      verifyNotes: [],
      sourceFiles: texFiles.map(f => f.filename),
    };

    addEvent(projectId, 'step-3', 'log',
      `  📊 识别 ${result.sections.length} 种题型, 总分 ${result.totalScore}`);

    // Verify
    result.verified = await verifyTemplate(projectId, result, texFiles);

    return result;
  } catch (err) {
    addEvent(projectId, 'step-3', 'error',
      `AI 模板提取失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    return heuristicExtractTemplate(projectId, course, texFiles);
  }
}

function heuristicExtractTemplate(
  projectId: number, course: string,
  texFiles: Array<typeof schema.projectFiles.$inferSelect>
): TemplateResult {
  addEvent(projectId, 'step-3', 'log', '🔧 使用启发式分析提取模板...');

  const result: TemplateResult = {
    course,
    totalScore: 0,
    duration: 120,
    sections: [],
    headerStyle: '',
    verified: false,
    verifyNotes: [],
    sourceFiles: texFiles.map(f => f.filename),
  };

  for (const f of texFiles) {
    let content: string;
    try { content = readFileSync(f.filepath, 'utf-8'); } catch { continue; }

    // Extract sections: 一、二、三、四...
    const sectionRe = /(?:^|\n)\s*([一二三四五六七八九十]+)[、．.]\s*([^\n]*)/gm;
    const sections: Array<{ label: string; scoreTotal: number; count: number }> = [];

    // Split content by section headers
    const parts = content.split(/(?:^|\n)\s*[一二三四五六七八九十]+[、．.]/);
    const sectionStarts: Array<{ index: number; label: string; line: string }> = [];
    let sm: RegExpExecArray | null;
    while ((sm = sectionRe.exec(content)) !== null) {
      sectionStarts.push({ index: sm.index, label: sm[1], line: sm[2].trim() });
    }

    // For each section part, count \score{} and questions
    for (let i = 0; i < sectionStarts.length; i++) {
      const start = sectionStarts[i].index;
      const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : content.length;
      const sectionContent = content.slice(start, end);

      // Count \score{n}
      const scores: number[] = [];
      const scoreRe = /\\score\{(\d+(?:\.\d+)?)\}/g;
      let scoreMatch: RegExpExecArray | null;
      while ((scoreMatch = scoreRe.exec(sectionContent)) !== null) {
        scores.push(Number(scoreMatch[1]));
      }

      // Count question numbers (1. 2. 3. ...)
      const qRe = /(?:^|\n)\s*(\d+)[\.\)、]/gm;
      let qCount = 0;
      while (qRe.exec(sectionContent)) qCount++;

      const scoreTotal = scores.reduce((a, b) => a + b, 0);
      const pointsPerQ = qCount > 0 ? Math.round(scoreTotal / qCount) : 0;

      // Detect type from section header line
      let type = '未知';
      const typeHints: Record<string, string> = {
        '选择': '选择题', '填空': '填空题', '计算': '计算题',
        '证明': '证明题', '简答': '简答题', '判断': '判断题',
        '论述': '论述题', '综合': '综合题',
      };
      for (const [k, v] of Object.entries(typeHints)) {
        if (sectionStarts[i].line.includes(k)) { type = v; break; }
      }
      // If no explicit type, guess from context
      if (type === '未知') {
        if (sectionContent.includes('A.') || sectionContent.includes('B.')) type = '选择题';
        else if (scores.length > 0 && scores[0] <= 6) type = '填空题';
        else if (scores.length > 0 && scores[0] >= 10) type = '计算题';
      }

      result.sections.push({
        index: i + 1,
        type,
        count: qCount || 1,
        pointsPerQuestion: pointsPerQ,
        subtotal: scoreTotal,
      });

      result.totalScore += scoreTotal;
    }

    addEvent(projectId, 'step-3', 'log',
      `  📊 ${f.filename}: ${result.sections.length} 个题型段, 总分 ${result.totalScore}, ${sectionStarts.length} 个锚点`);
  }

  // Ensure totalScore is 100 if no scores found
  if (result.totalScore === 0) result.totalScore = 100;

  return result;
}

// ====== Verification ======
async function verifyTemplate(
  projectId: number, result: TemplateResult,
  texFiles: Array<typeof schema.projectFiles.$inferSelect>
): Promise<boolean> {
  // Auto-check: subtotals match counts
  const autoErrors: string[] = [];
  let computedTotal = 0;
  for (const s of result.sections) {
    const expected = s.count * s.pointsPerQuestion;
    if (Math.abs(s.subtotal - expected) > 0.5) {
      autoErrors.push(`${s.type}: 小计${s.subtotal} ≠ ${s.count}×${s.pointsPerQuestion}=${expected}`);
    }
    computedTotal += s.subtotal;
  }
  if (Math.abs(computedTotal - result.totalScore) > 0.5) {
    autoErrors.push(`总分${result.totalScore} ≠ 各节小计之和${computedTotal}`);
  }

  if (autoErrors.length > 0) {
    result.verifyNotes.push(...autoErrors);
    addEvent(projectId, 'step-3', 'log', `  ⚠ 分值核对: ${autoErrors.join('; ')}`);
    return false;
  }

  // AI verification if available
  if (isConfigured() && texFiles.length > 0) {
    try {
      const validation = await runStructuredPrompt(independentValidationPrompt, {
        scope: 'template',
        canonicalObject: { totalScore: result.totalScore, duration: result.duration, sections: result.sections },
        constraints: { sourceFiles: result.sourceFiles }, deterministicFindings: [],
        sourceEvidence: texFiles.map(file => ({ sourceDocumentId: file.id, pageNumber: null, blockId: null, quote: readFileSync(file.filepath, 'utf-8') })),
      }, { maxTokens: 3000 });

      if (validation.output.status === 'ok' && validation.output.passed) {
        result.verifyNotes.push('核对子代理: PASS');
        return true;
      } else {
        result.verifyNotes.push(...validation.output.findings.map(finding => `${finding.severity}: ${finding.message}`));
        result.verifyNotes.push(...validation.output.issues.map(issue => `uncertain: ${issue.message}`));
        return false;
      }
    } catch {
      // AI unavailable, use auto-check result
    }
  }

  // Auto-check passed: mark verified
  result.verifyNotes.push('自动核对: PASS (分值自洽)');
  return true;
}

// ====== Save ======
export function saveTemplateOutputs(projectId: number, result: TemplateResult): void {
  const dir = getProjectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Save template.json
  const jsonPath = join(dir, 'template.json');
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

  // Save template.md
  const mdPath = join(dir, 'template.md');
  writeFileSync(mdPath, generateTemplateMd(result), 'utf-8');

  // Record files
  for (const { filepath, filename } of [
    { filepath: jsonPath, filename: 'template.json' },
    { filepath: mdPath, filename: 'template.md' },
  ]) {
    const existing = db.select().from(schema.projectFiles)
      .where(and(
        eq(schema.projectFiles.projectId, projectId),
        eq(schema.projectFiles.filename, filename),
      ))
      .get();

    if (existing) {
      db.update(schema.projectFiles)
        .set({ filepath, metadata: JSON.stringify({ sections: result.sections.length, verified: result.verified }) })
        .where(eq(schema.projectFiles.id, existing.id)).run();
    } else {
      db.insert(schema.projectFiles).values({
        projectId, type: 'template', filename, filepath,
        metadata: JSON.stringify({ sections: result.sections.length, verified: result.verified }),
      }).run();
    }
  }

  saveToDisk();
}

function generateTemplateMd(result: TemplateResult): string {
  const lines: string[] = [];
  lines.push('# 试卷模板');
  lines.push('');
  lines.push(`> 课程: ${result.course} | 总分: ${result.totalScore} | 时长: ${result.duration}分钟 | 核对: ${result.verified ? '✅ PASS' : '⚠ 待审核'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> ⏸ **待教师确认**: 请审核以下试卷结构，确认无误后点击「确认模板」继续流程。');
  lines.push('> 如需调整题型/题量/分值/时长，请点击「驳回」并附注修改意见。');
  lines.push('');

  // Structure table
  lines.push('## 题型结构');
  lines.push('');
  lines.push('| 序号 | 题型 | 题量 | 单题分值 | 小计 |');
  lines.push('|------|------|------|----------|------|');
  for (const s of result.sections) {
    lines.push(`| ${s.index} | ${s.type} | ${s.count} | ${s.pointsPerQuestion} | ${s.subtotal} |`);
  }
  lines.push(`| **合计** | | ${result.sections.reduce((a, s) => a + s.count, 0)} | | **${result.totalScore}** |`);
  lines.push('');

  // Score verification
  lines.push('## 分值核对');
  lines.push('');
  const computed = result.sections.reduce((a, s) => a + s.subtotal, 0);
  const matched = Math.abs(computed - result.totalScore) < 0.5;
  lines.push(`- Σ各题分值 = ${computed}`);
  lines.push(`- 声明总分 = ${result.totalScore}`);
  lines.push(`- 结果: ${matched ? '✅ 一致' : '⚠ 不一致'}`);
  lines.push('');
  lines.push(`- 考试时长: **${result.duration} 分钟**`);
  lines.push('');

  if (result.verifyNotes.length > 0) {
    lines.push('## 核对备注');
    lines.push('');
    for (const note of result.verifyNotes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}

// ====== Helpers ======
function parseJson<T>(text: string): T {
  // Try direct parse
  try { return JSON.parse(text) as T; } catch { /* continue */ }

  // Try extracting from code blocks
  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlock) {
    try { return JSON.parse(jsonBlock[1].trim()) as T; } catch { /* continue */ }
  }

  // Try finding outermost { }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]) as T; } catch { /* continue */ }
  }

  return {} as T;
}

function buildFallbackTemplate(course: string): TemplateResult {
  return {
    course,
    totalScore: 100,
    duration: 120,
    sections: [],
    headerStyle: '',
    verified: false,
    verifyNotes: ['未找到真题 LaTeX 文件，无法提取模板'],
    sourceFiles: [],
  };
}
