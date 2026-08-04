import { execFileSync, exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { isConfigured } from './ai.js';
import type { EnvInfo } from './envDetect.js';
import { runStructuredPrompt } from './promptRunner.js';
import { documentStructurePrompt } from '../prompts/documentStructurePrompt.js';
import { independentValidationPrompt } from '../prompts/independentValidationPrompt.js';

export interface ParseResult {
  success: boolean;
  sourceName: string;       // e.g. "2024-final"
  texPath: string;          // path to source-<name>.tex
  texContent: string;       // the LaTeX content
  format: string;           // detected format
  warnings: string[];       // non-fatal warnings
  verified: boolean;        // whether verification passed
  verifyNotes: string[];    // verification findings
}

interface FileRecord {
  filename: string;
  filepath: string;
}

/**
 * Parse a single past paper file to LaTeX.
 * Routes to the appropriate parser based on file extension.
 */
export async function parsePaper(
  file: FileRecord,
  outputDir: string,
  env: EnvInfo,
  options: { useAI?: boolean } = {}
): Promise<ParseResult> {
  const ext = extname(file.filename).toLowerCase();
  const baseName = basename(file.filename, ext);
  const sourceName = `source-${baseName}`;
  const texPath = join(outputDir, `${sourceName}.tex`);
  const warnings: string[] = [];

  let texContent = '';

  switch (ext) {
    case '.pdf':
      texContent = await parsePdf(file, env, options, warnings);
      break;
    case '.docx':
      texContent = await parseDocx(file, env, warnings);
      break;
    case '.doc':
      texContent = await parseDoc(file, env, warnings);
      break;
    case '.tex':
      texContent = await parseTex(file, warnings);
      break;
    case '.md':
    case '.txt':
    case '.markdown':
      texContent = await parseMd(file, env, warnings);
      break;
    default:
      // Try reading as text and let Claude figure it out
      texContent = await parseUnknown(file, env, options, warnings);
      break;
  }

  // Save the LaTeX output
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(texPath, texContent, 'utf-8');

  return {
    success: true,
    sourceName,
    texPath,
    texContent,
    format: ext,
    warnings,
    verified: false,
    verifyNotes: [],
  };
}

/**
 * Verify the parsed LaTeX against the original file.
 */
export async function verifyParsed(
  result: ParseResult,
  originalFile: FileRecord
): Promise<ParseResult> {
  const warnings: string[] = [...result.warnings];
  const verifyNotes: string[] = [];

  if (isConfigured()) {
    try {
      // Read a portion of the original and the output for comparison
      const origContent = readFileContent(originalFile.filepath, result.format);
      const texSample = result.texContent.slice(0, 5000);

      const validation = await runStructuredPrompt(independentValidationPrompt, {
        scope: 'document_fidelity', canonicalObject: { format: result.format, originalContent: origContent, latex: texSample },
        constraints: { compareQuestionNumbers: true, compareScores: true, compareFormulae: true },
        deterministicFindings: [], sourceEvidence: [],
      }, { maxTokens: 4000 });
      verifyNotes.push(...validation.output.findings.map(finding => `${finding.severity}: ${finding.message}`));
      verifyNotes.push(...validation.output.issues.map(issue => `uncertain: ${issue.message}`));

      if (validation.output.status === 'ok' && validation.output.passed) {
        result.verified = true;
      } else {
        warnings.push('校对发现差异，详见 verifyNotes');
      }
    } catch (err) {
      warnings.push(`校对步骤出错: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  } else {
    warnings.push('ANTHROPIC_API_KEY 未设置，跳过 AI 校对');
  }

  result.verifyNotes = verifyNotes;
  result.warnings = warnings;
  return result;
}

// ====== Format-specific parsers ======

async function parsePdf(
  file: FileRecord, env: EnvInfo, options: { useAI?: boolean },
  warnings: string[]
): Promise<string> {
  // Try pdf-parse first for text extraction
  try {
    const { PDFParse } = await import('pdf-parse');
    const dataBuffer = readFileSync(file.filepath);
    const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
    const pdfData = await parser.getText();

    const extractedText = pdfData?.text || '';
    const pageCount = Array.isArray(pdfData?.pages) ? pdfData.pages.length : (pdfData?.total ?? '?');
    warnings.push(`PDF 文本提取: ${pageCount} 页, ${extractedText.length} 字符`);

    if (extractedText.trim().length < 50) {
      warnings.push('PDF 文本内容极少，可能是扫描件/图片PDF，将使用AI视觉识读');
      // Fall through to AI approach
    } else if (isConfigured() && options.useAI !== false) {
      // Use Claude to structure extracted text into proper LaTeX
      const converted = await convertToLatex(extractedText, file.filename, 'pdf-extracted');
      if (converted && converted.trim().length > 0) {
        return converted;
      }
      // AI returned empty — fall back to raw extracted text
      warnings.push('AI 转换返回空，使用原始提取文本');
      return wrapInLatex(extractedText, file.filename);
    } else {
      // No AI, return raw text wrapped minimally
      return wrapInLatex(extractedText, file.filename);
    }
  } catch (err) {
    warnings.push(`pdf-parse 失败: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // If we reach here, either pdf-parse failed or the PDF is a scan
  // Try direct AI processing
  if (isConfigured() && options.useAI !== false) {
    warnings.push('使用 AI 视觉识读 PDF...');
    return await convertToLatex(
      `[PDF文件：${file.filename}，请直接读取此PDF并转为LaTeX]`,
      file.filename,
      'pdf-visual'
    );
  }

  // Last resort: note that AI API key is needed
  warnings.push('PDF 需要设置 ANTHROPIC_API_KEY 进行 AI 识读');
  return wrapInLatex(`% TODO: PDF 文件 "${file.filename}" 需要 AI 识读\n% 请设置 ANTHROPIC_API_KEY 环境变量后重新解析`, file.filename);
}

async function parseDocx(file: FileRecord, env: EnvInfo, warnings: string[]): Promise<string> {
  if (env.pandoc.available) {
    try {
      const tmpPath = file.filepath.replace(/\.docx$/i, '_tmp');
      const outPath = `${tmpPath}.tex`;

      execFileSync(env.pandoc.executable!, [file.filepath, '-o', outPath], {
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
      });

      const content = readFileSync(outPath, 'utf-8');
      warnings.push(`pandoc docx→tex 转换成功: ${content.length} 字符`);
      return content;
    } catch (err) {
      warnings.push(`pandoc 转换 docx 失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  // Fallback: read docx with basic extraction and use AI
  warnings.push('pandoc 不可用，尝试 AI 解析 docx');
  if (isConfigured()) {
    return await convertToLatex(
      `[DOCX文件：${file.filename}，请将内容转为LaTeX格式]`,
      file.filename,
      'docx'
    );
  }

  return wrapInLatex(`% TODO: 无法解析 docx 文件 "${file.filename}"\n% 请安装 pandoc 或设置 ANTHROPIC_API_KEY`, file.filename);
}

async function parseDoc(file: FileRecord, env: EnvInfo, warnings: string[]): Promise<string> {
  if (env.soffice.available && env.pandoc.available) {
    try {
      const outDir = join(file.filepath, '..');
      const sofficePath = env.soffice.path!;

      execFileSync(sofficePath, ['--headless', '--convert-to', 'docx', '--outdir', outDir, file.filepath], {
        encoding: 'utf-8',
        timeout: 60000,
        windowsHide: true,
      });

      const docxPath = file.filepath.replace(/\.doc$/i, '.docx');
      if (existsSync(docxPath)) {
        warnings.push('soffice doc→docx 转换成功');
        const content = await parseDocx(
          { filename: file.filename.replace(/\.doc$/i, '.docx'), filepath: docxPath },
          env,
          warnings
        );
        return content;
      }
    } catch (err) {
      warnings.push(`soffice 转换 .doc 失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  warnings.push('无法转换 .doc 文件，请用 Word 另存为 .docx 后重新上传');
  return wrapInLatex(`% ERROR: .doc 文件 "${file.filename}" 无法自动转换\n% 请用 Word 另存为 .docx 后重新上传`, file.filename);
}

async function parseTex(file: FileRecord, warnings: string[]): Promise<string> {
  const content = readFileSync(file.filepath, 'utf-8');
  warnings.push(`TeX 文件直接读取: ${content.length} 字符`);

  // Check if it has a preamble - if so, extract just the body
  const docBegin = content.search(/\\begin\{document\}/);
  if (docBegin !== -1) {
    const docEnd = content.search(/\\end\{document\}/);
    if (docEnd !== -1) {
      const body = content.slice(docBegin + 16, docEnd).trim();
      warnings.push('已提取 document 正文内容');
      return body;
    }
  }

  // Return as-is (it might be a fragment)
  return content;
}

async function parseMd(file: FileRecord, env: EnvInfo, warnings: string[]): Promise<string> {
  if (env.pandoc.available) {
    try {
      const outPath = file.filepath.replace(/\.(md|markdown|txt)$/i, '.tex');
      execFileSync(env.pandoc.executable!, [file.filepath, '-o', outPath], {
        encoding: 'utf-8',
        timeout: 15000,
        windowsHide: true,
      });
      const content = readFileSync(outPath, 'utf-8');
      warnings.push(`pandoc md→tex 转换成功: ${content.length} 字符`);
      return content;
    } catch (err) {
      warnings.push(`pandoc 转换 md 失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  // Markdown can be read directly — math is already LaTeX
  const content = readFileSync(file.filepath, 'utf-8');
  warnings.push('直接读取 md 文件（数学块已是 LaTeX）');
  return content;
}

async function parseUnknown(
  file: FileRecord, env: EnvInfo, options: { useAI?: boolean },
  warnings: string[]
): Promise<string> {
  warnings.push(`未知格式: ${extname(file.filename)}，尝试按文本读取`);

  try {
    const content = readFileSync(file.filepath, 'utf-8');
    if (isConfigured() && options.useAI !== false) {
      return await convertToLatex(content, file.filename, 'unknown-text');
    }
    return wrapInLatex(content, file.filename);
  } catch {
    return wrapInLatex(`% 无法读取文件 "${file.filename}"`, file.filename);
  }
}

// ====== AI-powered LaTeX conversion ======
async function convertToLatex(
  rawContent: string,
  filename: string,
  sourceType: string
): Promise<string> {
  try {
    const structured = await runStructuredPrompt(documentStructurePrompt, {
      document: { id: 1, filename, mimeType: sourceType, pages: [{ pageNumber: 1, text: rawContent, blockIds: [] }] },
      course: null,
    }, { maxTokens: 4000 });
    const structureComment = structured.output.sections
      .map(section => `% section ${section.id}: ${section.type} pages ${section.pageStart}-${section.pageEnd}`)
      .join('\n');
    return wrapInLatex(`${structureComment}\n${rawContent}`, filename);
  } catch (err) {
    // AI conversion failed — return empty so caller falls back to raw text
    console.error(`convertToLatex 失败 (${filename}): ${err instanceof Error ? err.message : 'Unknown'}`);
    return '';
  }
}

// ====== Helpers ======
function wrapInLatex(content: string, filename: string): string {
  return `% source: ${filename}
% auto-generated by exam-maker parser
% ${new Date().toISOString()}

${content}`;
}

function readFileContent(filepath: string, format: string): string {
  try {
    if (format === '.pdf') {
      // Can't read PDF directly, note it
      return `[PDF 文件: ${filepath}]`;
    }
    return readFileSync(filepath, 'utf-8').slice(0, 5000);
  } catch {
    return `[无法读取: ${filepath}]`;
  }
}
