import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { db, saveToDisk, schema } from '../db/index.js';

interface LatexSection {
  title: string;
  content: string;
}

export interface ImportedQuestionDraft {
  sourceQuestionNo: string;
  type: typeof schema.questions.$inferInsert.type;
  stem: string;
  answerText: string | null;
  defaultScore: number;
  sectionTitle: string;
}

interface CommandMatch {
  value: string;
  start: number;
  end: number;
}

function findBracedCommands(text: string, command: string): CommandMatch[] {
  const marker = `\\${command}{`;
  const results: CommandMatch[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const start = text.indexOf(marker, searchFrom);
    if (start < 0) break;
    let depth = 1;
    let cursor = start + marker.length;
    const valueStart = cursor;
    while (cursor < text.length && depth > 0) {
      const char = text[cursor];
      const escaped = cursor > 0 && text[cursor - 1] === '\\';
      if (!escaped && char === '{') depth++;
      if (!escaped && char === '}') depth--;
      cursor++;
    }
    if (depth === 0) {
      results.push({ value: text.slice(valueStart, cursor - 1), start, end: cursor });
    }
    searchFrom = Math.max(cursor, start + marker.length);
  }
  return results;
}

function toSections(text: string, command: 'section*' | 'subsection*'): LatexSection[] {
  const commands = findBracedCommands(text, command);
  return commands.map((item, index) => ({
    title: item.value.trim(),
    content: text.slice(item.end, commands[index + 1]?.start ?? text.length),
  }));
}

function enumerateItems(content: string): string[] {
  const begin = content.indexOf('\\begin{enumerate}');
  const end = content.lastIndexOf('\\end{enumerate}');
  if (begin < 0 || end <= begin) return [];
  return content.slice(begin + '\\begin{enumerate}'.length, end)
    .split(/\\item\s+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function questionType(title: string): ImportedQuestionDraft['type'] {
  if (title.includes('多选')) return 'multiple_choice';
  if (title.includes('选择')) return 'single_choice';
  if (title.includes('判断')) return 'true_false';
  if (title.includes('填空')) return 'fill_blank';
  if (title.includes('证明')) return 'essay';
  if (title.includes('计算')) return 'calculation';
  if (title.includes('论述')) return 'essay';
  return 'short_answer';
}

function sectionScore(title: string): number {
  const score = title.match(/每小题[\s\S]*?\\score\{(\d+(?:\.\d+)?)\}/)?.[1]
    ?? title.match(/每小题[^，,]*?(\d+(?:\.\d+)?)\s*分/)?.[1];
  return score ? Number(score) : 0;
}

function questionArea(tex: string): { questions: string; answers: string } {
  const questionStart = tex.indexOf('\\section*{试题}');
  const answerMarkers = ['\\section*{参考答案与评分标准}', '\\section*{参考答案}', '\\section*{答案'];
  const answerStart = answerMarkers
    .map((marker) => tex.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  return {
    questions: tex.slice(questionStart >= 0 ? questionStart : 0, answerStart >= 0 ? answerStart : tex.length),
    answers: answerStart >= 0 ? tex.slice(answerStart) : '',
  };
}

export function parseGeneratedPaperQuestions(tex: string): ImportedQuestionDraft[] {
  const areas = questionArea(tex);
  const questionSections = toSections(areas.questions, 'section*')
    .filter((section) => !['试题', '注意事项'].some((name) => section.title.trim() === name));
  const answerSections = toSections(areas.answers, 'subsection*');
  const drafts: ImportedQuestionDraft[] = [];

  questionSections.forEach((section, sectionIndex) => {
    const items = enumerateItems(section.content);
    const answerItems = enumerateItems(answerSections[sectionIndex]?.content ?? '');
    const defaultScore = sectionScore(section.title);
    items.forEach((stem, questionIndex) => {
      drafts.push({
        sourceQuestionNo: `${sectionIndex + 1}.${questionIndex + 1}`,
        type: questionType(section.title),
        stem,
        answerText: answerItems[questionIndex] ?? null,
        defaultScore,
        sectionTitle: section.title,
      });
    });
  });
  return drafts;
}

export function importGeneratedQuestionsFromProject(projectId: number): { imported: number; skipped: number } {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return { imported: 0, skipped: 0 };

  const generatedFiles = db.select().from(schema.projectFiles).where(and(
    eq(schema.projectFiles.projectId, projectId),
    eq(schema.projectFiles.type, 'generated_paper'),
  )).all();
  let imported = 0;
  let skipped = 0;

  for (const file of generatedFiles) {
    let content: string;
    try { content = readFileSync(file.filepath, 'utf-8'); } catch { continue; }
    const drafts = parseGeneratedPaperQuestions(content);
    for (const draft of drafts) {
      const existing = db.select({ id: schema.questions.id }).from(schema.questions).where(and(
        eq(schema.questions.sourceFileId, file.id),
        eq(schema.questions.sourceQuestionNo, draft.sourceQuestionNo),
      )).get();
      if (existing) {
        skipped++;
        continue;
      }
      db.insert(schema.questions).values({
        createdBy: project.userId,
        sourceFileId: file.id,
        sourceProjectId: projectId,
        sourceQuestionNo: draft.sourceQuestionNo,
        type: draft.type,
        stem: draft.stem,
        answerKey: draft.answerText ? JSON.stringify({ latex: draft.answerText }) : null,
        analysis: draft.answerText,
        defaultScore: draft.defaultScore,
        status: 'generated',
        aiGenerated: true,
        metadata: JSON.stringify({ sourceFilename: file.filename, sectionTitle: draft.sectionTitle }),
      }).run();
      imported++;
    }
  }

  if (imported > 0) saveToDisk();
  return { imported, skipped };
}
