import { and, eq } from 'drizzle-orm';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { isConfigured, getConfig } from './ai.js';
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
import { failGenerationStage, finishGenerationStage, startGenerationStage } from './generationJobService.js';

type ProjectRow = typeof schema.projects.$inferSelect;
const activeWorkflows = new Set<number>();

// ====== Main workflow entry ======
export async function startWorkflow(projectId: number, requestId?: string): Promise<void> {
  if (activeWorkflows.has(projectId)) {
    addEvent(projectId, 'workflow', 'log', 'ℹ 工作流正在运行，本次重复启动已忽略');
    return;
  }
  let project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).get();

  if (!project) throw new Error('Project not found');
  const generationJob = ensureGenerationJob(project, requestId);
  if (generationJob.taskStatus === 'cancelled') return;
  if (project.status === 'done' && !generatedSourcesNeedRerender(projectId)) {
    const now = new Date().toISOString();
    db.update(schema.generationJobs).set({ taskStatus: 'succeeded', status: 'succeeded', currentStage: null,
      finishedAt: generationJob.finishedAt ?? now, updatedAt: now }).where(eq(schema.generationJobs.id, generationJob.id)).run();
    saveToDisk();
    return;
  }
  db.update(schema.generationJobs).set({ taskStatus: 'running', status: 'running', finishedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.generationJobs.id, generationJob.id)).run();

  if (project.status === 'error') {
    const resumeStatus = inferResumeStatus(project);
    db.update(schema.projects)
      .set({ status: resumeStatus, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId)).run();
    project = { ...project, status: resumeStatus };
    addEvent(projectId, 'workflow', 'log', `↩ 从最近成功阶段继续：${resumeStatus}`);
  } else if (project.status === 'generating' && inferResumeStatus(project) === 'assigning') {
    // A development restart or process crash can leave a project marked as
    // generating with a stale/incompatible difficulty plan on disk.
    db.update(schema.projects)
      .set({ status: 'assigning', updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId)).run();
    project = { ...project, status: 'assigning' };
    addEvent(projectId, 'workflow', 'log', '↩ 检测到题位计划与模板不一致，从难度分配阶段恢复');
  } else if (project.status === 'done' && generatedSourcesNeedRerender(projectId)) {
    db.update(schema.projects)
      .set({ status: 'generating', updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId)).run();
    project = { ...project, status: 'generating' };
    addEvent(projectId, 'workflow', 'log', '↩ 检测到旧版导出中的公式或表格损坏，使用已保存题位重新渲染');
  }

  activeWorkflows.add(projectId);
  try {
    await runWorkflow(project, generationJob.id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const cancelled = db.select({ taskStatus: schema.generationJobs.taskStatus }).from(schema.generationJobs)
      .where(eq(schema.generationJobs.id, generationJob.id)).get()?.taskStatus === 'cancelled';
    if (cancelled) {
      addEvent(projectId, 'workflow', 'log', '⏹ 任务已取消；已完成阶段和产物均已保留');
      saveToDisk();
      return;
    }
    db.update(schema.projects)
      .set({ status: 'error', updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId)).run();
    db.update(schema.generationJobs).set({ taskStatus: 'failed', status: 'failed', errorSummary: msg,
      finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.generationJobs.id, generationJob.id)).run();
    addEvent(projectId, 'error', 'error', `❌ 流程出错: ${msg}`);
    saveToDisk();
  } finally {
    activeWorkflows.delete(projectId);
  }
}

function ensureGenerationJob(project: ProjectRow, requestId?: string) {
  const existing = db.select().from(schema.generationJobs).where(eq(schema.generationJobs.projectId, project.id)).get();
  if (existing) {
    if (requestId && !existing.requestId) {
      return db.update(schema.generationJobs).set({ requestId }).where(eq(schema.generationJobs.id, existing.id)).returning().get();
    }
    return existing;
  }
  let course = project.courseId
    ? db.select().from(schema.courses).where(eq(schema.courses.id, project.courseId)).get()
    : db.select().from(schema.courses).where(and(eq(schema.courses.ownerUserId, project.userId), eq(schema.courses.name, project.course))).get();
  if (!course) {
    const organizationId = db.select({ organizationId: schema.userOrganizations.organizationId }).from(schema.userOrganizations)
      .where(and(eq(schema.userOrganizations.userId, project.userId), eq(schema.userOrganizations.isDefault, true))).get()?.organizationId ?? 1;
    course = db.insert(schema.courses).values({ ownerUserId: project.userId, organizationId, name: project.course,
      status: 'active', instructorName: null }).returning().get();
  }
  if (project.courseId !== course.id) {
    db.update(schema.projects).set({ courseId: course.id, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, project.id)).run();
  }
  return db.insert(schema.generationJobs).values({ projectId: project.id, courseId: course.id,
    requestedBy: project.userId, pipelineVersion: 'legacy-project-workflow@2', numberOfSets: project.nSets,
    taskStatus: 'queued', requestId: requestId ?? null, idempotencyKey: `project:${project.id}` }).returning().get();
}

function assertNotCancelled(generationJobId: number): void {
  const job = db.select({ taskStatus: schema.generationJobs.taskStatus }).from(schema.generationJobs)
    .where(eq(schema.generationJobs.id, generationJobId)).get();
  if (job?.taskStatus === 'cancelled') throw new Error('任务已由用户取消');
}

async function trackedStage<T>(generationJobId: number, stage: string, work: () => Promise<T>): Promise<T> {
  assertNotCancelled(generationJobId);
  const stageRun = startGenerationStage(generationJobId, stage, {});
  try {
    const result = await work();
    finishGenerationStage(stageRun.id, { completed: true });
    return result;
  } catch (error) {
    failGenerationStage(stageRun.id, error, true);
    throw error;
  }
}

function inferResumeStatus(project: ProjectRow): string {
  const files = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, project.id)).all();
  const generatedCount = files.filter(file => file.type === 'generated_paper').length;
  if (generatedSourcesNeedRerender(project.id)) return 'generating';
  if (generatedCount >= project.nSets) return 'compiling';

  const dir = getProjectDir(project.id);
  if (existsSync(join(dir, 'difficulty.json'))) {
    try {
      const template = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf-8')) as {
        totalScore: number; sections: Array<{ count: number }>;
      };
      const difficultyPlan = JSON.parse(readFileSync(join(dir, 'difficulty.json'), 'utf-8')) as {
        slots: Array<{ score: number }>;
        summary?: { passed?: boolean };
      };
      if (isDifficultyPlanCompatible(template, difficultyPlan)) return 'generating';
      return 'assigning';
    } catch {
      return 'assigning';
    }
  }

  const checkpoints = db.select().from(schema.checkpoints)
    .where(eq(schema.checkpoints.projectId, project.id)).all();
  const checkpointStatus = new Map(checkpoints.map(checkpoint => [checkpoint.step, checkpoint.status]));
  if (checkpointStatus.get('template') === 'approved' && existsSync(join(dir, 'template.json'))) return 'assigning';
  if (checkpointStatus.get('blueprint') === 'approved' && existsSync(join(dir, 'blueprint.jsonl'))) return 'templating';
  if (files.some(file => file.type === 'source_tex')) return 'blueprinting';
  if (files.some(file => file.type === 'past_paper')) return 'parsing';
  return 'drafting';
}

export function isDifficultyPlanCompatible(
  template: { totalScore: number; sections: Array<{ count: number }> },
  difficultyPlan: { slots?: Array<{ score: number }>; summary?: { passed?: boolean } },
): boolean {
  const slots = difficultyPlan.slots ?? [];
  const expectedCount = template.sections.reduce((sum, section) => sum + section.count, 0);
  const plannedTotal = slots.reduce((sum, slot) => sum + slot.score, 0);
  return difficultyPlan.summary?.passed !== false &&
    slots.length === expectedCount && Math.abs(plannedTotal - template.totalScore) < 0.01;
}

export function latexSourceNeedsRerender(source: string): boolean {
  return /\\textbackslash/.test(source) || /^\s*\|.+\|\s*$/m.test(source);
}

function generatedSourcesNeedRerender(projectId: number): boolean {
  const generatedSources = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId)).all()
    .filter(file => ['generated_paper', 'student_paper'].includes(file.type));
  return generatedSources.some(file => {
    try { return latexSourceNeedsRerender(readFileSync(file.filepath, 'utf-8')); } catch { return false; }
  });
}

async function runWorkflow(project: ProjectRow, generationJobId: number): Promise<void> {
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
    const hasPapers = await trackedStage(generationJobId, 'document_extraction', () => step1ParsePapers(id));

    if (!hasPapers) {
      // No past papers uploaded — cannot proceed
      addEvent(id, 'step-1', 'error', '❌ 未找到真题文件，流程无法继续');
      addEvent(id, 'step-1', 'log', '💡 请先上传往年真题文件（pdf/docx/doc/tex/md），再点击重试');
      await updateStatus(id, 'error');
      const now = new Date().toISOString();
      db.update(schema.generationJobs).set({ taskStatus: 'failed', status: 'failed', errorSummary: '未找到真题文件',
        finishedAt: now, updatedAt: now }).where(eq(schema.generationJobs.id, generationJobId)).run();
      saveToDisk();
      return;
    }

    addEvent(id, 'step-1', 'done', '✅ 真题解析完成（详见上方日志）');
    await updateStatus(id, 'blueprinting');
    current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
  }

  // Step 2: Build blueprint → wait for teacher
  if (current.status === 'blueprinting') {
    addEvent(id, 'step-2', 'progress', '🔍 正在分析考点，构建双向细目表...');
    const blueprintPath = await trackedStage(generationJobId, 'historical_blueprint_generation', () => step2BuildBlueprint(id, project, difficulty));
    await resetCheckpointForReview(id, 'blueprint');
    addEvent(id, 'step-2', 'done', '✅ 双向细目表已生成', { file: blueprintPath });
    addEvent(id, 'step-2', 'log', '⏸ 请审核双向细目表，确认后流程继续');
    saveToDisk();
    db.update(schema.generationJobs).set({ taskStatus: 'blocked', status: 'pending', updatedAt: new Date().toISOString() })
      .where(eq(schema.generationJobs.id, generationJobId)).run();
    saveToDisk();
    return;
  }

  // Step 3: Extract template → wait for teacher
  if (current.status === 'templating') {
    addEvent(id, 'step-3', 'progress', '📐 正在提取试卷模板...');
    const templatePath = await trackedStage(generationJobId, 'exam_template_extraction', () => step3ExtractTemplate(id, project));
    await resetCheckpointForReview(id, 'template');
    addEvent(id, 'step-3', 'done', '✅ 试卷模板已提取', { file: templatePath });
    addEvent(id, 'step-3', 'log', '⏸ 请审核试卷模板（题型/分值/时长），确认后流程继续');
    saveToDisk();
    db.update(schema.generationJobs).set({ taskStatus: 'blocked', status: 'pending', updatedAt: new Date().toISOString() })
      .where(eq(schema.generationJobs.id, generationJobId)).run();
    saveToDisk();
    return;
  }

  // Step 4: Assign difficulty ratios to template slots (auto, no teacher confirmation)
  if (current.status === 'assigning') {
    addEvent(id, 'step-4', 'progress', '🎯 正在将难度配比落到模板题位...');
    const result = await trackedStage(generationJobId, 'paper_generation_planning', () => assignDifficulty(id, difficulty));
    if (result.passed) {
      addEvent(id, 'step-4', 'done', `✅ 难度核算达标: 基础${result.basicPct}% / 中等${result.mediumPct}% / 难${result.hardPct}%`);
    } else {
      addEvent(id, 'step-4', 'done', `⚠ 难度配比已分配 (${result.basicPct}/${result.mediumPct}/${result.hardPct})，未达到目标；将作为质量警告交由教师审核`);
    }
    addEvent(id, 'step-4', 'log', '📋 逐题难度指派表已并入 template.md');
    await updateStatus(id, 'generating');
    current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()!;
  }

  // Step 5: Generate N sets of papers
  if (current.status === 'generating') {
    addEvent(id, 'step-5', 'progress', `📝 开始生成 ${project.nSets} 套试卷...`);
    const results = await trackedStage(generationJobId, 'question_generation', () => generatePapers(
      id, project.course, project.nSets, difficulty, project.scope, project.verifyMode
    ));
    const successCount = results.filter(r => r.texSize > 0).length;
    if (successCount === 0) {
      throw new Error('试卷生成失败：没有产生可交付试卷，已保留前序解析、细目表和模板结果');
    }
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
    const results = await trackedStage(generationJobId, 'paper_export', () => compilePapers(id, project.outputType));
    const successCount = results.filter(r => r.success).length;
    if (results.length === 0 || successCount !== results.length) {
      throw new Error(`制品导出不完整：${successCount}/${results.length} 个制品通过 PDF、DOCX、Markdown 生成检查`);
    }
    addEvent(id, 'step-6', 'done', `✅ ${successCount}/${results.length} 个制品编译/转换完成`);
    addEvent(id, 'step-6', 'log', '⏸ 请从生成的试卷中选择要采用的套数并下载');
    await updateStatus(id, 'done');
    const now = new Date().toISOString();
    db.update(schema.generationJobs).set({ taskStatus: 'succeeded', status: 'succeeded', currentStage: null,
      errorSummary: null, finishedAt: now, updatedAt: now }).where(eq(schema.generationJobs.id, generationJobId)).run();
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
    type: 'env_report', // distinct type, NOT source_tex (won't be analyzed as a paper)
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
async function step1ParsePapers(projectId: number): Promise<boolean> {
  const pastPapers = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, 'past_paper'),
    ))
    .all();

  if (pastPapers.length === 0) {
    return false;
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

  return successCount > 0;
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

  if (result.entries.length === 0) {
    throw new Error('细目表生成失败：没有识别到任何题目，不能进入教师确认阶段');
  }

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
  const computedTotal = result.sections.reduce((sum, section) => sum + section.subtotal, 0);
  if (result.sections.length === 0 || computedTotal <= 0 || Math.abs(computedTotal - result.totalScore) > 0.01) {
    throw new Error('试卷模板不可执行：题型、题量或分值结构缺失，不能进入教师确认阶段');
  }
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

// ====== Helpers ======
async function updateStatus(projectId: number, status: string): Promise<void> {
  db.update(schema.projects)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId)).run();
  saveToDisk();
}

async function resetCheckpointForReview(projectId: number, step: 'blueprint' | 'template'): Promise<void> {
  db.update(schema.checkpoints)
    .set({
      status: 'pending',
      teacherNotes: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(
      eq(schema.checkpoints.projectId, projectId),
      eq(schema.checkpoints.step, step),
    ))
    .run();
  saveToDisk();
}

export function getProjectDir(projectId: number): string {
  return join(process.cwd(), 'data', 'projects', String(projectId));
}

function readStepFile(projectId: number, type: string): string {
  const files = db.select().from(schema.projectFiles)
    .where(and(
      eq(schema.projectFiles.projectId, projectId),
      eq(schema.projectFiles.type, type),
    ))
    .all();

  if (files.length === 0) return '';
  try {
    return readFileSync(files[0].filepath, 'utf-8');
  } catch {
    return '';
  }
}
