import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { getProjectDir } from './workflow.js';
import { and, eq } from 'drizzle-orm';
import { importGeneratedQuestionsFromProject } from './questionImporter.js';
import { isConfigured } from './ai.js';
import { runStructuredPrompt } from './promptRunner.js';
import { independentValidationPrompt } from '../prompts/independentValidationPrompt.js';
import { detectEnvironment, type EnvInfo } from './envDetect.js';

export interface CompileResult {
  paperName: string;
  texPath: string;
  outputFiles: string[];
  success: boolean;
  errors: string[];
}

export async function compilePapers(
  projectId: number, outputType: string
): Promise<CompileResult[]> {
  const questionImport = importGeneratedQuestionsFromProject(projectId);
  if (questionImport.imported > 0 || questionImport.skipped > 0) {
    addEvent(projectId, 'step-6', 'log',
      `📚 AI题目入库: 新增${questionImport.imported}题, 已存在${questionImport.skipped}题`);
  }
  const dir = getProjectDir(projectId);
  const outputDir = join(dir, 'output');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const papers = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, 'generated_paper'),
    ))
    .all();

  if (papers.length === 0) {
    addEvent(projectId, 'step-6', 'log', '⚠ 未找到生成的试卷文件');
    return [];
  }

  const env = detectEnvironment();
  const results: CompileResult[] = [];

  addEvent(projectId, 'step-6', 'log', `📦 ${papers.length} 套试卷待编译/转换`);
  addEvent(projectId, 'step-6', 'log', `🎯 输出格式: ${outputType}`);

  for (const paper of papers) {
    const result: CompileResult = {
      paperName: paper.filename,
      texPath: paper.filepath,
      outputFiles: [],
      success: false,
      errors: [],
    };

    addEvent(projectId, 'step-6', 'progress', `处理: ${paper.filename}`);

    // Step 1: Compile LaTeX
    if (env.latex.available) {
      const { pdfPath, errors } = compileLatexFile(paper.filepath, outputDir, env);
      if (pdfPath) result.outputFiles.push(pdfPath);
      result.errors.push(...errors);

      if (pdfPath) {
        addEvent(projectId, 'step-6', 'log', `  ✅ ${basename(paper.filename)} → PDF (${env.latex.engine})`);
      } else {
        addEvent(projectId, 'step-6', 'log', `  ⚠ ${basename(paper.filename)} 编译失败，保留 .tex`);
        const texCopy = join(outputDir, paper.filename);
        if (paper.filepath !== texCopy) copyFileSync(paper.filepath, texCopy);
        result.outputFiles.push(texCopy);
      }
    } else {
      addEvent(projectId, 'step-6', 'log', `  ℹ 无 LaTeX 引擎，保留 .tex 源文件`);
      const texCopy = join(outputDir, paper.filename);
      if (paper.filepath !== texCopy) copyFileSync(paper.filepath, texCopy);
      result.outputFiles.push(texCopy);
    }

    // Step 2: Convert if needed
    if (outputType !== 'latex' && env.pandoc.available) {
      const srcTex = join(outputDir, basename(paper.filepath));
      const { outPath, errors: convErrors } = convertFile(srcTex, outputDir, outputType, env.pandoc.executable!);
      if (outPath) result.outputFiles.push(outPath);
      result.errors.push(...convErrors);

      if (outPath) {
        addEvent(projectId, 'step-6', 'log', `  🔄 ${outputType}: ${basename(outPath)} ✅`);
        // Post-conversion verify
        const verified = await verifyConversion(paper.filepath, outPath, outputType);
        addEvent(projectId, 'step-6', 'log', `  ${verified ? '✅' : '⚠'} 转换核对${verified ? ' PASS' : ' 发现差异'}`);
      }
    } else if (outputType !== 'latex' && !env.pandoc.available) {
      addEvent(projectId, 'step-6', 'log', `  ⚠ pandoc 未安装，无法转为 ${outputType}`);
    }

    result.success = result.outputFiles.length > 0;

    // Save output files as project files
    for (const outFile of result.outputFiles) {
      const outName = basename(outFile);
      const existing = db.select().from(schema.projectFiles)
        .where(and(
          eq(schema.projectFiles.projectId, projectId),
          eq(schema.projectFiles.filename, outName),
        ))
        .get();
      if (!existing) {
        db.insert(schema.projectFiles).values({
          projectId, type: 'final_output', filename: outName, filepath: outFile,
          metadata: JSON.stringify({ source: paper.filename, format: outputType }),
        }).run();
      }
    }

    results.push(result);
  }

  const successCount = results.filter(r => r.success).length;
  addEvent(projectId, 'step-6', 'done', `📊 ${successCount}/${results.length} 套处理完成`);
  saveToDisk();
  return results;
}

// ====== LaTeX Compilation ======
function compileLatexFile(texPath: string, outputDir: string, env: EnvInfo): { pdfPath?: string; errors: string[] } {
  const errors: string[] = [];
  const engine = env.latex.engine!;
  const executable = env.latex.executable!;
  const baseName = basename(texPath, '.tex');

  // Copy tex to output dir
  const workTex = join(outputDir, basename(texPath));
  if (texPath !== workTex) copyFileSync(texPath, workTex);

  try {
    const args = engine === 'tectonic'
      ? [workTex, '--outdir', outputDir]
      : engine === 'latexmk'
        ? ['-xelatex', '-interaction=nonstopmode', '-halt-on-error', `-outdir=${outputDir}`, workTex]
        : ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${outputDir}`, workTex];
    execFileSync(executable, args, { encoding: 'utf-8', timeout: 60000, cwd: outputDir, windowsHide: true });

    // Run twice for cross-references
    if (engine === 'xelatex') {
      execFileSync(executable, ['-interaction=nonstopmode', `-output-directory=${outputDir}`, workTex],
        { timeout: 60000, cwd: outputDir, windowsHide: true });
    }

    const pdfPath = join(outputDir, `${baseName}.pdf`);
    if (existsSync(pdfPath)) {
      // Check Overfull
      try {
        const logPath = join(outputDir, `${baseName}.log`);
        const log = readFileSync(logPath, 'utf-8');
        const overfulls = (log.match(/Overfull/g) || []).length;
        if (overfulls > 5) errors.push(`${overfulls}个Overfull`);
      } catch { /* log file not available */ }
      return { pdfPath, errors };
    }

    errors.push('未生成PDF');
    return { errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    errors.push(`编译失败: ${msg.slice(0, 200)}`);
    return { errors };
  }
}

// ====== Pandoc Conversion ======
function convertFile(texPath: string, outputDir: string, format: string, pandocExecutable: string): { outPath?: string; errors: string[] } {
  const errors: string[] = [];
  const baseName = basename(texPath, '.tex');

  // Create conversion-safe copy
  const convTex = join(outputDir, `${baseName}.conv.tex`);
  let content = readFileSync(texPath, 'utf-8');
  content = content.replace(/\\score\{(\d+(?:\.\d+)?)\}/g, '（$1分）');
  content = content.replace(/\\begin\{pingfen\}/g, '\\textbf{评分说明：}\\begin{itemize}');
  content = content.replace(/\\end\{pingfen\}/g, '\\end{itemize}');
  content = content.replace(/\\blank/g, '\\underline{\\hspace{2.8cm}}');
  content = content.replace(/\\xlongequal\{([^}]+)\}/g, '\\overset{$1}{=}');
  writeFileSync(convTex, content, 'utf-8');

  try {
    const outExt = format === 'docx' ? 'docx' : 'md';
    const outPath = join(outputDir, `${baseName}.${outExt}`);

    const args = format === 'docx'
      ? [convTex, '-o', outPath]
      : [convTex, '-o', outPath, '-t', 'gfm', '--wrap=none', '--from=latex+raw_tex'];
    execFileSync(pandocExecutable, args, { encoding: 'utf-8', timeout: 30000, windowsHide: true });

    if (existsSync(outPath)) {
      // Check score count
      const origScores = (texPath.match(/\\score\{/g) || []).length;
      const convScores = (content.match(/（\d+分）/g) || []).length;
      if (convScores < origScores) {
        errors.push(`分值丢失: ${origScores}→${convScores}`);
      }
      return { outPath, errors };
    }
    errors.push('转换未生成文件');
    return { errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    errors.push(`转换失败: ${msg.slice(0, 200)}`);
    return { errors };
  }
}

// ====== Post-conversion Check ======
async function verifyConversion(texSource: string, convertedFile: string, format: string): Promise<boolean> {
  try {
    const tex = readFileSync(texSource, 'utf-8');
    if (format === 'docx') {
      const docx = readFileSync(convertedFile);
      return docx.byteLength > 4 && docx[0] === 0x50 && docx[1] === 0x4b;
    }
    if (!isConfigured()) return false;
    const conv = readFileSync(convertedFile, 'utf-8');
    const validation = await runStructuredPrompt(independentValidationPrompt, {
      scope: 'export_integrity', canonicalObject: { sourceLatex: tex, convertedContent: conv, format },
      constraints: { preserveQuestions: true, preserveFormulae: true, preserveTables: true, preserveScores: true },
      deterministicFindings: [], sourceEvidence: [],
    }, { maxTokens: 2500 });
    return validation.output.status === 'ok' && validation.output.passed;
  } catch { return false; }
}
