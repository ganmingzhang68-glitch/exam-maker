import { eq } from 'drizzle-orm';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { isConfigured, sendMessage, getConfig } from './ai.js';
import type { DifficultyRatio } from '@exam-maker/shared';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { detectEnvironment, envReport } from './envDetect.js';
import { parsePaper, verifyParsed } from './paperParser.js';
import { analyzeBlueprint } from './blueprint.js';
import { analyzeTemplate, saveTemplateOutputs } from './template.js';
import { assignDifficulty } from './difficultyAssigner.js';
import { generatePapers } from './paperGenerator.js';
import { compilePapers } from './compiler.js';

type ProjectRow = typeof schema.projects.$inferSelect;

// ====== Main workflow entry ======
export async function startWorkflow(projectId: number): Promise<void> {
  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).get();

  if (!project) throw new Error('Project not found');

  try {
    await runWorkflow(project);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    db.update(schema.projects)
      .set({ status: 'error', updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId)).run();
    addEvent(projectId, 'error', 'error', `❌ 流程出错: ${msg}`);
    saveToDisk();
  }
}

async function runWorkflow(project: ProjectRow): Promise<void> {
  const id = project.id;
  const difficulty = JSON.parse(project.difficulty as string) as DifficultyRatio;

  // Re-read project to get current status (may have been updated externally)
  let current = db.select().from(schema.projects)
    .where(eq(schema.projects.id, id)).get();
  if (!current) return;

  // Step 0: Environment detection
  if (current.status === 'drafting') {
    addEvent(id, 'step-0', 'progress', '🔍 探测运行环境...');
    await step0DetectEnv(id);
    addEvent(id, 'step-0', 'done', '✅ 参数已配置，环境探测完成');
    await updateStatus(id, 'parsing');
    current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
  }

  // Step 1: Parse past papers → LaTeX
  if (current.status === 'parsing') {
    addEvent(id, 'step-1', 'progress', '📄 开始解析真题文件...');
    await step1ParsePapers(id);
    addEvent(id, 'step-1', 'done', '✅ 真题解析完成（详见上方日志）');
    await updateStatus(id, 'blueprinting');
    current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
  }

  // Step 2: Build blueprint → wait for teacher
  if (current.status === 'blueprinting') {
    addEvent(id, 'step-2', 'progress', '🔍 正在分析考点，构建双向细目表...');
    const blueprintPath = await step2BuildBlueprint(id, project, difficulty);
    addEvent(id, 'step-2', 'done', '✅ 双向细目表已生成', { file: blueprintPath });
    addEvent(id, 'step-2', 'log', '⏸ 请审核双向细目表，确认后流程继续');
    saveToDisk();
    return;
  }

  // Step 3: Extract template → wait for teacher
  if (current.status === 'templating') {
    addEvent(id, 'step-3', 'progress', '📐 正在提取试卷模板...');
    const templatePath = await step3ExtractTemplate(id, project);
    addEvent(id, 'step-3', 'done', '✅ 试卷模板已提取', { file: templatePath });
    addEvent(id, 'step-3', 'log', '⏸ 请审核试卷模板（题型/分值/时长），确认后流程继续');
    saveToDisk();
    return;
  }

  // Step 4: Assign difficulty ratios to template slots (auto, no teacher confirmation)
  if (current.status === 'assigning') {
    addEvent(id, 'step-4', 'progress', '🎯 正在将难度配比落到模板题位...');
    const result = await assignDifficulty(id, difficulty);
    if (result.passed) {
      addEvent(id, 'step-4', 'done', `✅ 难度核算达标: 基础${result.basicPct}% / 中等${result.mediumPct}% / 难${result.hardPct}%`);
    } else {
      addEvent(id, 'step-4', 'done', `⚠ 难度配比已分配 (${result.basicPct}/${result.mediumPct}/${result.hardPct})，偏差在可接受范围内`);
    }
    addEvent(id, 'step-4', 'log', '📋 逐题难度指派表已并入 template.md');
    await updateStatus(id, 'generating');
    current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
  }

  // Step 5: Generate N sets of papers
  if (current.status === 'generating') {
    addEvent(id, 'step-5', 'progress', `📝 开始生成 ${project.nSets} 套试卷...`);
    const results = await generatePapers(
      id, project.course, project.nSets, difficulty,
      project.scope, project.verifyMode
    );
    const successCount = results.filter(r => r.texSize > 0).length;
    if (successCount === project.nSets) {
      addEvent(id, 'step-5', 'done', `✅ ${project.nSets} 套试卷全部生成！`);
    } else {
      addEvent(id, 'step-5', 'done', `⚠ ${successCount}/${project.nSets} 套生成成功`);
    }
    await updateStatus(id, 'compiling');
    current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
  }

  // Step 6: Compile/convert + deliver → wait for teacher selection
  if (current.status === 'compiling') {
    addEvent(id, 'step-6', 'progress', '🔧 正在编译/转换产出文件...');
    const results = await compilePapers(id, project.outputType);
    const successCount = results.filter(r => r.success).length;
    addEvent(id, 'step-6', 'done', `✅ ${successCount}/${results.length} 套编译/转换完成`);
    addEvent(id, 'step-6', 'log', '⏸ 请从生成的试卷中选择要采用的套数并下载');
    await updateStatus(id, 'done');
  }

  saveToDisk();
}

export async function continueWorkflow(projectId: number): Promise<void> {
  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).get();
  if (!project) return;

  // After blueprint approval → run template extraction
  if (project.status === 'blueprinting') {
    await updateStatus(projectId, 'templating');
  }
  // After template approval → run difficulty assignment (step 4), then generation (step 5)
  else if (project.status === 'templating') {
    await updateStatus(projectId, 'assigning');
  }

  await startWorkflow(projectId);
}

// ====== Step 0: Environment Detection ======
async function step0DetectEnv(projectId: number): Promise<void> {
  const env = detectEnvironment();
  const report = envReport(env);

  // Save env report as a project file
  const projectDir = getProjectDir(projectId);
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
  const reportPath = join(projectDir, 'environment.md');
  writeFileSync(reportPath, report, 'utf-8');

  db.insert(schema.projectFiles).values({
    projectId,
    type: 'source_tex', // reuse type for env report
    filename: 'environment.md',
    filepath: reportPath,
    metadata: JSON.stringify({ type: 'env_report', env }),
  }).run();

  // Emit key findings as events
  if (env.pandoc.available) {
    addEvent(projectId, 'step-0', 'log', `✅ pandoc: ${env.pandoc.version}`);
  } else {
    addEvent(projectId, 'step-0', 'log', '⚠ pandoc 未安装 → docx/md 互转降级为 AI 解析');
  }

  if (env.soffice.available) {
    addEvent(projectId, 'step-0', 'log', `✅ LibreOffice: 可用于 .doc 转换`);
  } else {
    addEvent(projectId, 'step-0', 'log', '⚠ LibreOffice 未安装 → .doc 文件请用 Word 另存为 .docx');
  }

  if (env.latex.available) {
    addEvent(projectId, 'step-0', 'log', `✅ LaTeX 引擎: ${env.latex.engine}`);
  } else {
    addEvent(projectId, 'step-0', 'log', '⚠ 无 LaTeX 引擎 → 跳过本地编译，交付 .tex 源（可在 Overleaf 编译）');
  }

  if (env.python.hasSympy) {
    addEvent(projectId, 'step-0', 'log', '✅ Python + sympy: 支持符号验算');
  } else if (env.python.available) {
    addEvent(projectId, 'step-0', 'log', '⚠ Python 可用但无 sympy → 退到 numpy 数值验算');
  }

  if (env.ai.available) {
    addEvent(projectId, 'step-0', 'log', `🤖 AI: ${env.ai.provider} / ${env.ai.model} (${env.ai.baseUrl})`);
  } else {
    addEvent(projectId, 'step-0', 'log', '⚠ AI 未配置 → 考点分析与命题退为启发式');
    addEvent(projectId, 'step-0', 'log', '💡 设置 AI_API_KEY 环境变量以启用 AI');
    addEvent(projectId, 'step-0', 'log', '💡 支持 OpenAI 兼容接口 (DeepSeek/通义千问/OpenAI/...)，通过 AI_PROVIDER, AI_BASE_URL, AI_MODEL 配置');
  }

  saveToDisk();
}

// ====== Step 1: Parse Past Papers → LaTeX ======
async function step1ParsePapers(projectId: number): Promise<void> {
  const pastPapers = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .where(eq(schema.projectFiles.type, 'past_paper'))
    .all();

  if (pastPapers.length === 0) {
    addEvent(projectId, 'step-1', 'log', '⚠ 未找到真题文件，跳过解析步骤');
    addEvent(projectId, 'step-1', 'log', '💡 请先上传往年真题文件（pdf/docx/doc/tex/md）');
    return;
  }

  addEvent(projectId, 'step-1', 'log', `📋 共 ${pastPapers.length} 份真题待解析`);

  const env = detectEnvironment();
  const outputDir = join(getProjectDir(projectId), 'source-tex');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pastPapers.length; i++) {
    const file = pastPapers[i];
    const ext = extname(file.filename).toLowerCase();
    addEvent(projectId, 'step-1', 'progress',
      `正在解析 [${i + 1}/${pastPapers.length}]: ${file.filename} (${ext})`);

    try {
      // Dispatch to format-specific parser
      addEvent(projectId, 'step-1', 'log', `🔍 检测到 ${ext} 格式，选择对应解析器...`);

      const result = await parsePaper(
        { filename: file.filename, filepath: file.filepath },
        outputDir,
        env,
        { useAI: isConfigured() }
      );

      // Notify about parsing method used
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          addEvent(projectId, 'step-1', 'log', `  ⚠ ${w}`);
        }
      }

      // Save parsed LaTeX as project file
      const texName = result.sourceName + '.tex';
      db.insert(schema.projectFiles).values({
        projectId,
        type: 'source_tex',
        filename: texName,
        filepath: result.texPath,
        metadata: JSON.stringify({
          sourceFile: file.filename,
          format: result.format,
          verified: result.verified,
          charCount: result.texContent.length,
        }),
      }).run();

      addEvent(projectId, 'step-1', 'log',
        `✅ ${file.filename} → ${texName} (${result.texContent.length} 字符)`);

      // Run verification pass
      addEvent(projectId, 'step-1', 'progress',
        `🔍 校对: ${file.filename} (比对原文与转写结果)...`);

      const verified = await verifyParsed(result, file);

      if (verified.verified) {
        addEvent(projectId, 'step-1', 'log', `  ✅ 校对 PASS: ${file.filename}`);
        // Update file metadata with verified status
        const fileRecord = db.select().from(schema.projectFiles)
          .where(eq(schema.projectFiles.filepath, result.texPath)).get();
        if (fileRecord) {
          db.update(schema.projectFiles)
            .set({
              metadata: JSON.stringify({
                sourceFile: file.filename,
                format: result.format,
                verified: true,
                charCount: result.texContent.length,
                verifyNotes: verified.verifyNotes.slice(0, 5),
              }),
            })
            .where(eq(schema.projectFiles.id, fileRecord.id)).run();
        }
      } else {
        addEvent(projectId, 'step-1', 'log',
          `  ⚠ 校对发现差异: ${file.filename}（详见产物文件的元数据）`);
        // Save verify notes alongside the tex file
        const notesPath = result.texPath.replace('.tex', '.verify.md');
        writeFileSync(notesPath,
          `# 校对报告 — ${file.filename}\n\n` +
          verified.verifyNotes.join('\n'), 'utf-8');
      }

      successCount++;
      saveToDisk();
    } catch (err) {
      failCount++;
      const msg = err instanceof Error ? err.message : 'Unknown';
      addEvent(projectId, 'step-1', 'error',
        `❌ 解析 ${file.filename} 失败: ${msg}`);
    }
  }

  addEvent(projectId, 'step-1', 'log',
    `📊 解析完成: ${successCount} 成功, ${failCount} 失败, 共 ${pastPapers.length} 份`);
}

// ====== Step 2: Build Blueprint (Bidirectional Spec Table) ======
async function step2BuildBlueprint(
  projectId: number, project: ProjectRow, difficulty: DifficultyRatio
): Promise<string> {
  addEvent(projectId, 'step-2', 'log', '🔍 启动考点分析子代理 + 核对子代理...');

  const result = await analyzeBlueprint(
    projectId,
    project.course,
    project.scope,
    difficulty
  );

  const blueprintPath = join(getProjectDir(projectId), 'blueprint.md');

  // Emit structured summary
  addEvent(projectId, 'step-2', 'log', `📊 共计 ${result.entries.length} 道题, ${result.kpList.length} 个考点`);
  addEvent(projectId, 'step-2', 'log',
    `📈 难度分布: 基础${result.difficultySummary.basic.actual}% / 中等${result.difficultySummary.medium.actual}% / 难${result.difficultySummary.hard.actual}%`);

  for (const kp of result.kpList.filter(k => k.isRequired)) {
    addEvent(projectId, 'step-2', 'log', `  ⭐ 必考: ${kp.id} ${kp.name} (${kp.frequency}次/${kp.totalPoints}分)`);
  }

  if (!result.verified) {
    addEvent(projectId, 'step-2', 'log', '⚠ 核对子代理发现改进点，请教师重点审核');
  }

  saveToDisk();
  return blueprintPath;
}

// ====== Step 3: Extract Template ======
async function step3ExtractTemplate(projectId: number, project: ProjectRow): Promise<string> {
  addEvent(projectId, 'step-3', 'log', '📐 启动模板提取子代理 + 核对子代理...');

  const result = await analyzeTemplate(projectId, project.course);
  saveTemplateOutputs(projectId, result);

  const templatePath = join(getProjectDir(projectId), 'template.md');

  addEvent(projectId, 'step-3', 'log', `📊 提取 ${result.sections.length} 种题型, 总分 ${result.totalScore}, 时长 ${result.duration}分钟`);
  for (const s of result.sections) {
    addEvent(projectId, 'step-3', 'log', `  📝 ${s.type}: ${s.count}题 × ${s.pointsPerQuestion}分 = ${s.subtotal}分`);
  }

  if (result.verified) {
    addEvent(projectId, 'step-3', 'log', '✅ 核对通过：分值自洽，与真题一致');
  } else {
    addEvent(projectId, 'step-3', 'log', '⚠ 核对发现差异（详见模板产物），请教师重点审核');
  }

  saveToDisk();
  return templatePath;
}

// ====== Step 5: Generate Papers ======
async function step5GeneratePapers(
  projectId: number, project: ProjectRow, difficulty: DifficultyRatio
): Promise<void> {
  addEvent(projectId, 'step-5', 'log', `即将生成 ${project.nSets} 套试卷`);
  addEvent(projectId, 'step-5', 'log', `难度配比: 基础${difficulty.basic}% / 中等${difficulty.medium}% / 难${difficulty.hard}%`);

  if (!isConfigured()) {
    addEvent(projectId, 'step-5', 'log', '⚠ ANTHROPIC_API_KEY 未设置，无法生成试卷');
    addEvent(projectId, 'step-5', 'log', '💡 请设置 ANTHROPIC_API_KEY 环境变量后重试');
    return;
  }

  const paperDir = join(getProjectDir(projectId), 'papers');
  if (!existsSync(paperDir)) mkdirSync(paperDir, { recursive: true });

  // Gather context from previous steps
  const blueprint = readStepFile(projectId, 'blueprint');
  const template = readStepFile(projectId, 'template');
  const texSources = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .where(eq(schema.projectFiles.type, 'source_tex'))
    .all();

  for (let i = 1; i <= project.nSets; i++) {
    addEvent(projectId, 'step-5', 'progress', `正在生成第 ${i}/${project.nSets} 套试卷...`);

    try {
      const prompt = buildPaperPrompt(project, difficulty, i, blueprint, template, texSources);
      const result = await sendMessage(prompt, [{ role: 'user', content: `请生成第${i}套试卷` }], { maxTokens: 8000 });

      const paperName = `paper-${i}.tex`;
      const paperPath = join(paperDir, paperName);
      writeFileSync(paperPath, result, 'utf-8');

      db.insert(schema.projectFiles).values({
        projectId,
        type: 'generated_paper',
        filename: paperName,
        filepath: paperPath,
        metadata: JSON.stringify({ setNumber: i, difficulty }),
      }).run();

      addEvent(projectId, 'step-5', 'log', `✅ 第${i}套试卷已生成: ${paperName} (${result.length} 字符)`);
      saveToDisk();
    } catch (err) {
      addEvent(projectId, 'step-5', 'error',
        `第${i}套生成失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

function buildPaperPrompt(
  project: ProjectRow, difficulty: DifficultyRatio, setNum: number,
  blueprint: string, template: string,
  texSources: Array<typeof schema.projectFiles.$inferSelect>
): string {
  let contextPrompt = `你是一位经验丰富的《${project.course}》教师和命题专家。请命制一套期末模拟试卷（第${setNum}/${project.nSets}套）。

## 命题参数
- 课程: ${project.course}
- 范围: ${project.scope || '全书'}
- 难度配比(按分值): 基础${difficulty.basic}% / 中等${difficulty.medium}% / 难${difficulty.hard}%
- 总分: 100分 · 时长: 120分钟
- 核验方式: ${project.verifyMode}
`;

  if (blueprint) {
    contextPrompt += `\n## 双向细目表（考点与难度分配）\n${blueprint.slice(0, 2000)}\n`;
  }
  if (template) {
    contextPrompt += `\n## 试卷模板（题型与分值结构）\n${template.slice(0, 1500)}\n`;
  }
  if (texSources.length > 0) {
    contextPrompt += `\n## 真题参考（风格对齐，不抄原题）\n`;
    const sample = texSources.slice(0, 1).map(f => {
      try { return readFileSync(f.filepath, 'utf-8').slice(0, 2000); }
      catch { return ''; }
    }).join('\n');
    contextPrompt += sample;
  }

  contextPrompt += `

## 输出要求
1. LaTeX 格式，包含试卷抬头（课程名、学期、考试说明、总分、时长）
2. 试题部分：每题后标注 \`\\score{n}\`
3. 参考答案与**分步评分标准**
4. 命题说明（考点覆盖、难度构成）

## 质量红线
- 结构对齐模板，分值合计准确
- 难度按分值配比，不超纲不偏怪
- 计算题答案整齐、可验算
- 与真题同考点不同形态（换数据/换情境/换设问角度）`;

  return contextPrompt;
}

// ====== Helpers ======
async function updateStatus(projectId: number, status: string): Promise<void> {
  db.update(schema.projects)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId)).run();
  saveToDisk();
}

export function getProjectDir(projectId: number): string {
  return join(process.cwd(), 'data', 'projects', String(projectId));
}

function readStepFile(projectId: number, type: string): string {
  const files = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .where(eq(schema.projectFiles.type, type))
    .all();

  if (files.length === 0) return '';
  try {
    return readFileSync(files[0].filepath, 'utf-8');
  } catch {
    return '';
  }
}
