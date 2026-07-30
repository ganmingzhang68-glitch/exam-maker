import { eq } from 'drizzle-orm';
import { db, schema, saveToDisk } from '../db/index.js';
import { addEvent } from '../controllers/project.js';
import { isConfigured, sendMessage } from './claude.js';
import type { DifficultyRatio } from '@exam-maker/shared';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

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

  // Step 0: Already done (project configuration)
  if (project.status === 'drafting') {
    addEvent(id, 'step-0', 'done', '✅ 参数已配置完成');
    await updateStatus(id, 'parsing');
  }

  // Step 1: Parse past papers → LaTeX
  if (project.status === 'parsing') {
    addEvent(id, 'step-1', 'progress', '📄 开始解析真题文件...');
    await step1ParsePapers(id);
    await updateStatus(id, 'blueprinting');
  }

  // Step 2: Build blueprint (bidirectional spec table) → wait for teacher
  if (project.status === 'blueprinting') {
    addEvent(id, 'step-2', 'progress', '🔍 正在分析考点，构建双向细目表...');
    const blueprintPath = await step2BuildBlueprint(id, project, difficulty);
    addEvent(id, 'step-2', 'done', '✅ 双向细目表已生成', {
      file: blueprintPath,
    });
    addEvent(id, 'step-2', 'log', '⏸ 请审核双向细目表，确认后流程继续');
    saveToDisk();
    return; // Wait for teacher confirmation
  }

  // Step 3: Extract template → wait for teacher
  if (project.status === 'templating') {
    addEvent(id, 'step-3', 'progress', '📐 正在提取试卷模板...');
    const templatePath = await step3ExtractTemplate(id, project);
    addEvent(id, 'step-3', 'done', '✅ 试卷模板已提取', {
      file: templatePath,
    });
    addEvent(id, 'step-3', 'log', '⏸ 请审核试卷模板（题型/分值/时长），确认后流程继续');
    saveToDisk();
    return; // Wait for teacher confirmation
  }

  // Step 4: Assign difficulty ratios to template slots
  if (project.status === 'templating') {
    // Actually, after template is approved, we move to generating directly
    // Step 4 is computation-only, no teacher action needed
    await updateStatus(id, 'generating');
  }

  // Step 5: Generate N sets of papers
  if (project.status === 'generating') {
    addEvent(id, 'step-5', 'progress', `📝 开始生成 ${project.nSets} 套试卷...`);
    await step5GeneratePapers(id, project, difficulty);
    await updateStatus(id, 'compiling');
  }

  // Step 6: Compile/convert + deliver → wait for teacher selection
  if (project.status === 'compiling') {
    addEvent(id, 'step-6', 'progress', '🔧 正在编译/转换产出文件...');
    await step6Compile(id, project);
    addEvent(id, 'step-6', 'done', `✅ ${project.nSets} 套试卷生成完毕！请教师选卷下载`);
    addEvent(id, 'step-6', 'log', '⏸ 请从生成的试卷中选择要采用的套数并下载');
    await updateStatus(id, 'done');
  }

  saveToDisk();
}

// Continue workflow after teacher approves a checkpoint
export async function continueWorkflow(projectId: number): Promise<void> {
  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).get();

  if (!project) return;

  // If template was approved and we were at templating, move to generating
  if (project.status === 'templating') {
    await updateStatus(projectId, 'generating');
  }
  // If blueprint was approved and we were at blueprinting, move to templating
  else if (project.status === 'blueprinting') {
    await updateStatus(projectId, 'templating');
  }

  await startWorkflow(projectId);
}

// ====== Step implementations ======

async function step1ParsePapers(projectId: number): Promise<void> {
  const pastPapers = db.select().from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .where(eq(schema.projectFiles.type, 'past_paper'))
    .all();

  if (pastPapers.length === 0) {
    addEvent(projectId, 'step-1', 'log', '⚠ 未找到真题文件，跳过解析步骤');
    return;
  }

  addEvent(projectId, 'step-1', 'log', `找到 ${pastPapers.length} 份真题文件`);

  for (const file of pastPapers) {
    addEvent(projectId, 'step-1', 'progress', `正在解析: ${file.filename}`);

    if (isConfigured()) {
      try {
        const fileContent = readFileSync(file.filepath, 'utf-8').slice(0, 2000);
        const prompt = `你是一份试卷解析助手。请将以下真题文件内容解析为结构化的LaTeX格式。
保留所有题目、选项、分值标注。只输出LaTeX代码，不要解释。

文件: ${file.filename}
内容:
${fileContent}`;

        const result = await sendMessage(prompt, [{ role: 'user', content: '请解析这份真题为LaTeX格式' }]);

        // Save parsed LaTeX
        const texName = basename(file.filename, extname(file.filename)) + '.tex';
        const texPath = join(getProjectDir(projectId), 'source-tex', texName);
        const texDir = join(getProjectDir(projectId), 'source-tex');
        if (!existsSync(texDir)) mkdirSync(texDir, { recursive: true });
        writeFileSync(texPath, result, 'utf-8');

        // Record the source_tex file
        db.insert(schema.projectFiles).values({
          projectId,
          type: 'source_tex',
          filename: texName,
          filepath: texPath,
          metadata: JSON.stringify({ sourceFile: file.filename }),
        }).run();

        addEvent(projectId, 'step-1', 'log', `✅ ${file.filename} 解析完成 → ${texName}`);
      } catch (err) {
        addEvent(projectId, 'step-1', 'error', `解析 ${file.filename} 失败: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    } else {
      addEvent(projectId, 'step-1', 'log', `⚠ ANTHROPIC_API_KEY 未设置，跳过AI解析: ${file.filename}`);
      addEvent(projectId, 'step-1', 'log', '💡 设置 ANTHROPIC_API_KEY 环境变量以启用AI解析');
    }
  }
}

async function step2BuildBlueprint(
  projectId: number, project: ProjectRow, difficulty: DifficultyRatio
): Promise<string> {
  const blueprintPath = join(getProjectDir(projectId), 'blueprint.md');
  const content = `# 双向细目表 — ${project.course}

## 课程: ${project.course}
## 难度配比: 基础${difficulty.basic}% / 中等${difficulty.medium}% / 难${difficulty.hard}%

---

> ⏸ **待教师确认**: 请审核以下考点分类和难度分布，确认无误后点击「确认细目表」继续流程。
> 如需调整，请点击「驳回」并附注修改意见。

## 考点清单

（AI 分析生成中...请上传真题文件后，系统将自动分析考点并填充此表）

| 考点编号 | 考点名称 | 认知层次 | 题型 | 分值占比 | 备注 |

## 逐题考点映射

| 题号 | 题型 | 考点 | 分值 | 难度 |
|`

  const dir = getProjectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(blueprintPath, content, 'utf-8');

  // Record the blueprint file
  db.insert(schema.projectFiles).values({
    projectId,
    type: 'blueprint',
    filename: 'blueprint.md',
    filepath: blueprintPath,
  }).run();

  return blueprintPath;
}

async function step3ExtractTemplate(projectId: number, project: ProjectRow): Promise<string> {
  const templatePath = join(getProjectDir(projectId), 'template.md');
  const content = `# 试卷模板 — ${project.title}

## 课程: ${project.course}
## 生成套数: ${project.nSets}
## 输出格式: ${project.outputType}

---

> ⏸ **待教师确认**: 请审核以下试卷结构（题型/题量/分值/时长），确认无误后点击「确认模板」继续。

## 题型结构

| 序号 | 题型 | 题量 | 单题分值 | 小计 |
|------|------|------|----------|------|
| 1 | 选择题 | — | — | — |
| 2 | 填空题 | — | — | — |
| 3 | 计算题 | — | — | — |
| 4 | 证明题 | — | — | — |
| **合计** | | | | **100** |

## 考试时长: 120 分钟

> 上传真题后，系统将自动从真题中提取题型结构并填充上表。
`

  const dir = getProjectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(templatePath, content, 'utf-8');

  db.insert(schema.projectFiles).values({
    projectId,
    type: 'template',
    filename: 'template.md',
    filepath: templatePath,
  }).run();

  return templatePath;
}

async function step5GeneratePapers(
  projectId: number, project: ProjectRow, difficulty: DifficultyRatio
): Promise<void> {
  addEvent(projectId, 'step-5', 'log', `即将生成 ${project.nSets} 套试卷`);
  addEvent(projectId, 'step-5', 'log', `难度配比: 基础${difficulty.basic}% / 中等${difficulty.medium}% / 难${difficulty.hard}%`);
  addEvent(projectId, 'step-5', 'log', `核验方式: ${project.verifyMode}`);

  if (!isConfigured()) {
    addEvent(projectId, 'step-5', 'log', '⚠ ANTHROPIC_API_KEY 未设置，无法生成试卷');
    addEvent(projectId, 'step-5', 'log', '💡 请设置 ANTHROPIC_API_KEY 环境变量后重试');
    return;
  }

  const paperDir = join(getProjectDir(projectId), 'papers');
  if (!existsSync(paperDir)) mkdirSync(paperDir, { recursive: true });

  for (let i = 1; i <= project.nSets; i++) {
    addEvent(projectId, 'step-5', 'progress', `正在生成第 ${i}/${project.nSets} 套试卷...`);

    try {
      const prompt = buildPaperPrompt(project, difficulty, i);
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

      addEvent(projectId, 'step-5', 'log', `✅ 第${i}套试卷已生成: ${paperName}`);
    } catch (err) {
      addEvent(projectId, 'step-5', 'error',
        `第${i}套生成失败: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

function buildPaperPrompt(project: ProjectRow, difficulty: DifficultyRatio, setNum: number): string {
  return `你是一位经验丰富的${project.course}教师和命题专家。请为《${project.course}》课程命制一套期末模拟试卷（第${setNum}套）。

## 命题要求
- 课程: ${project.course}
- 命题范围: ${project.scope || '全书'}
- 难度配比(按分值): 基础${difficulty.basic}% / 中等${difficulty.medium}% / 难${difficulty.hard}%
- 总分: 100分
- 考试时长: 120分钟

## 输出格式
请使用LaTeX格式输出，包含：
1. 试卷抬头（课程名、考试说明、总分、时长）
2. 试题部分（每题标注分值 \\score{n}）
3. 参考答案与分步评分标准

## 质量要求
- 结构清晰，题型合理（选择题、填空题、计算题、证明题/论述题）
- 难度分布符合配比要求
- 题目不超纲、不偏怪
- 计算题答案整齐、可验算
- 参考答案详尽，每题含分步评分标准
- 使用 \\score{n} 命令在每一步标注得分`;
}

async function step6Compile(projectId: number, project: ProjectRow): Promise<void> {
  const paperDir = join(getProjectDir(projectId), 'papers');
  if (!existsSync(paperDir)) {
    addEvent(projectId, 'step-6', 'log', '⚠ 未找到生成的试卷文件');
    return;
  }

  addEvent(projectId, 'step-6', 'log',
    `📦 ${project.nSets} 套试卷已就绪，格式: ${project.outputType}`);
  addEvent(projectId, 'step-6', 'log',
    `📁 文件位置: ${paperDir}`);
  addEvent(projectId, 'step-6', 'log',
    '💡 提示: 如安装了LaTeX引擎可编译为PDF，或在Overleaf中打开.tex文件编译');
}

// ====== Helpers ======
async function updateStatus(projectId: number, status: string): Promise<void> {
  db.update(schema.projects)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId)).run();
  saveToDisk();
}

function getProjectDir(projectId: number): string {
  const dir = join(process.cwd(), 'data', 'projects', String(projectId));
  return dir;
}
