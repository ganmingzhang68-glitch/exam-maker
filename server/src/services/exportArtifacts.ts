import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { db, schema } from '../db/index.js';

export type ExportAudience = 'student' | 'teacher' | 'grader' | 'internal';
export type ArtifactType = 'question_paper' | 'answer_key' | 'rubric' | 'combined_teacher_package';
export type ExportFormat = 'markdown' | 'latex' | 'docx';
export interface CanonicalExportQuestion { number: string; type: string; score: number; stem: unknown; options?: Array<{ id: string; content: unknown }> | null; answer?: unknown; explanation?: unknown; rubric?: { totalScore: number; items: Array<{ description: string; points: number }> } | null }
export interface CanonicalExportPaper { id: number; version: number; title: string; durationMinutes: number; totalScore: number; instructions: unknown[]; questions: CanonicalExportQuestion[] }

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return textOf(item.markdown ?? item.latex ?? item.text ?? item.content ?? item.optionId ?? item.optionIds ?? item.value ?? '');
  }
  return value == null ? '' : String(value);
}

function assertAudience(type: ArtifactType, audience: ExportAudience): void {
  if (audience === 'student' && type !== 'question_paper') throw new Error('Student audience may only receive question_paper');
}

export function renderMarkdown(paper: CanonicalExportPaper, type: ArtifactType, audience: ExportAudience): string {
  assertAudience(type, audience);
  const includeAnswer = audience !== 'student' && type !== 'question_paper';
  const lines = [`# ${paper.title}`, '', `时长：${paper.durationMinutes} 分钟　总分：${paper.totalScore} 分`, ''];
  paper.questions.forEach((q) => {
    lines.push(`## ${q.number}. ${textOf(q.stem)}（${q.score} 分）`);
    for (const option of q.options ?? []) lines.push(`- ${option.id}. ${textOf(option.content)}`);
    if (includeAnswer && type !== 'rubric') lines.push('', `参考答案：${textOf(q.answer)}`, `解析：${textOf(q.explanation)}`);
    if (includeAnswer && (type === 'rubric' || type === 'combined_teacher_package')) {
      lines.push('', '评分标准：');
      for (const item of q.rubric?.items ?? []) lines.push(`- ${item.description}（${item.points} 分）`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function latexEscape(value: string): string { return value.replace(/([#%&_{}])/g, '\\$1'); }
export function renderLatex(paper: CanonicalExportPaper, type: ArtifactType, audience: ExportAudience): string {
  const markdown = renderMarkdown(paper, type, audience);
  const body = markdown.split('\n').map((line) => {
    if (line.startsWith('# ')) return `\\section*{${latexEscape(line.slice(2))}}`;
    if (line.startsWith('## ')) return `\\subsection*{${latexEscape(line.slice(3))}}`;
    if (line.startsWith('- ')) return `\\noindent ${latexEscape(line.slice(2))}\\par`;
    return `${latexEscape(line)}\\par`;
  }).join('\n');
  return `\\documentclass[UTF8]{ctexart}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const crc = crc32(entry.data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(entry.data.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, entry.data);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(entry.data.length, 20); directory.writeUInt32LE(entry.data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + entry.data.length;
  }
  const centralData = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}
function xmlEscape(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function renderDocx(paper: CanonicalExportPaper, type: ArtifactType, audience: ExportAudience): Buffer {
  const paragraphs = renderMarkdown(paper, type, audience).split('\n').map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join('');
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`) },
  ]);
}

export function validateDocx(buffer: Buffer): { validZip: boolean; requiredParts: boolean; xmlDocument: boolean } {
  const latin = buffer.toString('latin1'); const utf8 = buffer.toString('utf8');
  return { validZip: buffer.subarray(0, 2).toString() === 'PK', requiredParts: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].every((part) => latin.includes(part)), xmlDocument: utf8.includes('<w:document') && utf8.includes('</w:document>') };
}

export function createExportArtifact(paper: CanonicalExportPaper, type: ArtifactType, audience: ExportAudience, format: ExportFormat) {
  assertAudience(type, audience);
  const content = format === 'markdown' ? Buffer.from(renderMarkdown(paper, type, audience)) : format === 'latex' ? Buffer.from(renderLatex(paper, type, audience)) : renderDocx(paper, type, audience);
  const storageRoot = resolve(process.env.EXPORT_STORAGE_DIR || join(process.cwd(), 'server', 'data', 'exports'));
  mkdirSync(storageRoot, { recursive: true });
  const extension = format === 'markdown' ? 'md' : format === 'latex' ? 'tex' : 'docx';
  const storagePath = join(storageRoot, `${randomUUID()}.${extension}`);
  writeFileSync(storagePath, content);
  const contentHash = createHash('sha256').update(content).digest('hex');
  const sourcePaperHash = createHash('sha256').update(JSON.stringify(paper)).digest('hex');
  const integrity = { questionCount: paper.questions.length, answerCount: audience === 'student' ? 0 : paper.questions.filter((q) => q.answer != null).length, totalScore: paper.totalScore, compiled: null, opened: format === 'docx' ? Object.values(validateDocx(content)).every(Boolean) : null };
  return db.insert(schema.exportArtifacts).values({ generatedPaperId: paper.id, paperVersion: paper.version, artifactType: type, audience, format, storagePath, sha256: contentHash, contentHash, rendererVersion: 'canonical-renderer@1', sourcePaperHash, integrity: JSON.stringify(integrity), generationStatus: 'succeeded', validationStatus: integrity.opened === false ? 'failed' : 'passed', status: 'ready' }).returning().get();
}

export function readArtifactFile(storagePath: string): Buffer { return readFileSync(storagePath); }
