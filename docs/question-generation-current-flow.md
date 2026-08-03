# 当前题目生成调用链与复现记录

> 本文描述 2026-08-03 仓库中的实际实现，不描述目标设计。  
> “已验证”仅指本次实际运行覆盖的分支；外部 AI、Pandoc 和 LaTeX 工具链未成功运行的部分均明确标注。

## 1. 两条相邻但未统一的业务链

```text
项目工作流
Project → ProjectFile(past_paper/source_tex/blueprint/template/generated_paper/final_output)
        → Checkpoint + JobEvent

题库/考试工作流
Question → PaperQuestion → Paper → Exam → Attempt → Answer

唯一桥接
generated_paper(.tex)
  → compiler.ts:compilePapers()
  → questionImporter.ts:importGeneratedQuestionsFromProject()
  → Question
```

项目工作流生成的是文件，题库工作流管理的是数据库题目；不存在同时驱动二者的统一 `PaperDocument`。

## 2. 正常前端调用链在上传后中断

### 2.1 教师操作

1. 页面 `/projects/new`：`client/src/pages/ProjectNew.tsx:ProjectNew`。
2. `onFinish()` 调 `client/src/services/project.ts:createProject()`。
3. 选择了文件时，继续调 `uploadPapers()`。
4. 最后 `navigate('/projects/:id')`。

### 2.2 实际 HTTP 与状态变化

#### 创建项目

- 接口：`POST /api/projects`
- 路由：`server/src/routes/project.ts`
- 控制器：`server/src/controllers/project.ts:createProject()`
- 输入：

```ts
{
  title: string;
  course: string;
  scope?: string;
  difficulty: { basic: number; medium: number; hard: number }; // 合计100
  nSets: number;                 // 1..50
  outputType: 'latex'|'docx'|'md';
  verifyMode: 'auto'|'computational'|'conceptual'|'mixed';
}
```

- 输出：`ApiResponse<Project>`，状态初始为 `drafting`。
- 副作用：插入 `projects`；插入 blueprint/template/selection 三个 `checkpoints`；创建项目目录。

#### 上传

- 接口：`POST /api/projects/:id/upload`
- 请求：`multipart/form-data`，重复字段 `files`。
- 前端：`project.ts:uploadPapers()`。
- Multer：`upload.ts:uploadPastPapers`。
- 保存路径：`<process.cwd()>/data/projects/<id>/past_papers/<安全文件名>_<timestamp>.<ext>`。
- 数据库行：

```ts
ProjectFile {
  id: number;
  projectId: number;
  type: 'past_paper';
  filename: string;      // 原名
  filepath: string;      // 实际磁盘路径
  metadata: {
    size: number;
    mimetype: string;
    storedName: string;
  };
}
```

- 控制器：`upload.ts:handleUpload()` 把 `projects.status` 更新为 `parsing`。
- 输出：`201 ApiResponse<ProjectFile[]>`。

#### 断点

`ProjectNew.tsx:onFinish()` **没有调用** `client/src/services/project.ts:startWorkflow()`。工作区 `ProjectWorkspace.tsx` 又只在 `project.status === 'drafting'` 显示 `/start` 按钮；上传后状态已经是 `parsing`。因此教师通过 UI 上传文件后，没有可见入口启动流程。

现有 `server/data/exam-maker.db` 也出现同样状态：项目 2 为 `parsing`，只有 1 个 `past_paper` 和 1 条 upload event，没有后续事件。

## 3. 手动调用 `/start` 后的完整后端链

本节是通过隔离运行显式调用 `POST /api/projects/:id/start` 后追踪的链路。

### 3.1 启动与后台执行

- 接口：`POST /api/projects/:id/start`
- 控制器：`project.ts:startProjectWorkflow()`。
- 响应：立即返回 `{success:true,message:'工作流已启动'}`。
- 后台：直接调用 `workflow.ts:startWorkflow(projectId)`，没有 queue/job worker。
- 顶层错误：`startWorkflow()` catch 后把项目设为 `error` 并写一条 event；不向原 HTTP 响应返回失败。

### 3.2 Step 0：环境探测

- 函数：`workflow.ts:step0DetectEnv()` → `envDetect.ts:detectEnvironment()`。
- 仅当状态为 `drafting` 时运行。
- 产物：`environment.md` 和 `project_files(type='env_report')`。

常见上传链中上传已把状态改为 `parsing`，所以 Step 0 被跳过。前端创建页单独请求 `GET /api/projects/env` 展示环境，但该结果不一定固化到项目。

### 3.3 Step 1：文件解析

- 调度：`workflow.ts:step1ParsePapers()`。
- 输入查询：该项目所有 `project_files.type='past_paper'`。
- 每文件调用：

```ts
parsePaper(
  { filename: string, filepath: string },
  outputDir: string,
  env: EnvInfo,
  { useAI: boolean }
): Promise<ParseResult>
```

- `ParseResult` 定义于 `paperParser.ts`：

```ts
{
  success: boolean;
  sourceName: string;
  texPath: string;
  texContent: string;
  format: string;
  warnings: string[];
  verified: boolean;
  verifyNotes: string[];
}
```

#### 格式分支

- `.pdf` → `parsePdf()` → `pdf-parse` 合并文本 → 可选 `convertToLatex()`。
- `.docx` → `parseDocx()` → Pandoc；无 Pandoc则只给 AI 文件名占位符。
- `.doc` → `parseDoc()` → LibreOffice + Pandoc。
- `.tex` → `parseTex()`，直接读取并取 document 正文。
- `.md/.txt` → `parseMd()`，Pandoc 或直接文本。

#### AI 转写输入/输出

- 构建：`paperParser.ts:convertToLatex()`。
- system：要求忠实转写、不确定处标 TODO、只输出 LaTeX。
- user：文件名、来源类型、`rawContent.slice(0,12000)`。
- 预期输出：自由文本 LaTeX，无 Schema。
- 解析：不去除代码 fence、不检查结构，直接返回字符串。
- 失败：catch 后只 `console.error`，返回空字符串；调用者可能回退原始文本。

#### 校对

- `verifyParsed(result, originalFile)`。
- TEX/文本：把原文前 3,000 字和结果前 5,000 字送 AI，查找 `VERDICT: PASS`。
- PDF/DOCX/DOC：不实际比对，直接 `verified=true`。

#### 存储

- 写 `source-tex/source-<basename>.tex`。
- 插入 `project_files(type='source_tex')`，metadata 含 `sourceFile/format/verified/charCount`。
- 只要 `parsePaper()` 没抛异常，即使内容是 `% ERROR`/`% TODO`，也会计为成功。
- 至少一份成功即进入 `blueprinting`。

### 3.4 Step 2：蓝图/考点分析

- 调度：`workflow.ts:step2BuildBlueprint()`。
- 服务：`blueprint.ts:analyzeBlueprint()`。
- 输入：所有 `source_tex`、`course`、`scope`、项目目标 `difficulty`。

AI 路径对每个 TEX 调 `analyzeQuestions()`：

```ts
BlueprintEntry {
  src: string;
  no: string;
  type: string;
  points: number;
  kp: string[];
  difficulty: '基础'|'中等'|'难';
  cognition: '记忆'|'理解'|'应用'|'分析'|'评价/综合';
  stem_kind: string;
  note?: string;
}
```

- Prompt 输入：单份 TEX 前 10,000 字。
- 期望输出：每题一行 JSONL。
- 解析：`blueprint.ts:parseJsonl()` 用正则抓每行 `{...}`；坏行跳过；缺字段填默认，不验证类型/枚举/数值范围。
- 后处理：`buildKpList()` 生成扁平 K1..Kn；出现至少 2 次自动设为 `isRequired=true`。
- 矩阵：`buildMatrix()` 聚合“考点×基础/中等/难”的分值。
- 核对：`verifyBlueprint()` 再调 AI，仅返回 boolean；核对原文不保存。
- 产物：`blueprint.jsonl`、`blueprint.md` 和两个 `project_files(type='blueprint')`。

关键错误：如果 `entries.length===0`，`analyzeBlueprint()` 提前返回，**不写产物**；但 `step2BuildBlueprint()` 仍返回预期路径，`runWorkflow()` 写“蓝图已生成”并等待教师确认。

检查点：

- 前端 GET `/api/projects/:id/blueprint` 读取磁盘 JSONL/MD。
- POST `/api/projects/:id/checkpoints/blueprint` 调 `project.ts:updateCheckpoint()`。
- 输入 `{action:'approve'|'reject',notes?:string}`。
- 没有 PUT/PATCH 蓝图内容的接口；批准不会校验产物存在、题目数或 verified 状态。

### 3.5 Step 3：模板提取

- 批准 blueprint 后，`continueWorkflow()` 把状态改为 `templating`。
- 服务：`template.ts:analyzeTemplate()`。
- 输入：所有 `source_tex`，每份最多 5,000 字拼接。
- AI 预期 JSON：

```ts
TemplateResult {
  course: string;
  totalScore: number;
  duration: number;
  sections: Array<{
    index: number;
    type: string;
    count: number;
    pointsPerQuestion: number;
    subtotal: number;
  }>;
  headerStyle: string;
  verified: boolean;
  verifyNotes: string[];
  sourceFiles: string[];
}
```

- 解析：`template.ts:parseJson()` 尝试直接 JSON、代码块、最外层大括号；失败返回 `{}`，随后默认总分 100、时长 120、空 sections。
- fallback：`heuristicExtractTemplate()` 正则匹配中文大题、题号和 `\score{}`。
- 校验：`verifyTemplate()` 检查 `subtotal=count*pointsPerQuestion`、总分求和，再可选 AI verdict。
- 产物：`template.json`、`template.md`，记录为 `project_files(type='template')`。

检查点 `/checkpoints/template` 和 blueprint 一样只能批准/驳回，不能修改模板。

### 3.6 Step 4：难度题位分配

- 服务：`difficultyAssigner.ts:assignDifficulty()`。
- 输入：`template.json`、可选 `blueprint.jsonl`、目标比例。
- `buildSlots()` 将模板 section 展开为题位，8 分以上题目由 `splitLargeQuestion()` 人为拆成 2/3 个难度小问。
- 无蓝图时 fallback 有 bug：它用构建中的 `slots.length` 判断当前位置，导致普通题容易全部落为“难”。
- 若不达标：`tryAdjustWithAI()` 期望拆题 JSON；失败后 `tryAutoAdjust()` 只尝试把部分“中等”改“基础”，对“难过多”无有效调整。
- 产物：`difficulty.json`；并把难度核算 Markdown 追加到 `template.md`。
- 无教师检查点，直接进入生成。

`DifficultyAssignment` 只表达题位预测标签；没有教师难度或学生答题统计难度。

### 3.7 Step 5：生成 N 套新卷

- 服务：`paperGenerator.ts:generatePapers()`。
- 每套：`generateSinglePaper()`。
- system prompt：`buildSystemPrompt()`。
- user prompt：`buildUserPrompt()`。

每套实际 AI 输入包括：

- 课程、范围、目标难度、verifyMode；
- `template` 文件集合前 3,000 字；
- `blueprint` 文件集合前 3,000 字；
- `difficulty.json` 前 1,500 字；
- 仅第一份历史 `source_tex` 前 2,000 字；
- 防重台账最后 12 条。

期望输出：一段 LaTeX，同时包含：

1. `\section*{试题}`；
2. 所有新题；
3. `\section*{参考答案与评分标准}`；
4. 每题答案和分步评分；
5. 命题说明。

输出处理：

- `extractLatexBody()` 去 document wrapper 或 code fence，否则原样。
- `ensureLatexBody()` 判断不像 LaTeX时做极少 Markdown→LaTeX 正则替换。
- `wrapInDocument()` 加固定 ctexart preamble。
- 写 `papers/paper-<n>.tex`。
- 插入 `project_files(type='generated_paper')`。

所谓防重：

- `extractLedgerEntries()` 在每个 `\score{}` 附近抓最多 200 字上下文。
- `detectAxis()/detectType()/extractKp()` 用中文关键词猜类型、轴和少量硬编码考点。
- `detectAxis()` 无匹配时随机选择前三个轴。
- 没有实际题干相似度、语义相似度或和历史题比较。

答案/质量验证：

- 仅 `verifyMode==='computational'` 才调 `runVerification()`。
- 验算和生成可使用同一模型/provider，不独立；只解析 `TOTAL` 或统计 PASS/FAIL 字符串。
- `qualityReview()` 对每套调用 AI；只有出现 `REVIEW: PASS` 时才写 `.review.md`，发现问题时反而不保存 review，也不阻断、不修复。
- 任一套失败会 catch 并返回 `texSize=0`，但工作流无最低成功数 gate。

### 3.8 Step 6：题目回填和导出

- 服务：`compiler.ts:compilePapers()`。
- 第一个动作：`questionImporter.ts:importGeneratedQuestionsFromProject()`。

#### LaTeX → Question

导入器要求：

- 精确的 `\section*{试题}`；
- 题型大节为其他 `\section*{...}`；
- 每节用一个 `enumerate`；
- 答案总节为指定 `\section*{参考答案...}`；
- 答案题型节必须为 `\subsection*{...}` 且顺序和题目节一致。

对第 `sectionIndex/questionIndex` 个题：

```ts
ImportedQuestionDraft {
  sourceQuestionNo: `${sectionIndex+1}.${questionIndex+1}`;
  type: QuestionType;       // 从 section 标题猜
  stem: string;             // 整个 \item 文本，可能仍含 \score/选项
  answerText: string|null;  // 同下标答案 item
  defaultScore: number;     // 只从 section 标题解析
  sectionTitle: string;
}
```

数据库写入：

```ts
Question row {
  sourceFileId: generated_paper.id;
  sourceProjectId: projectId;
  sourceQuestionNo: string;
  stem: draft.stem;
  options: null;
  answerKey: answer ? JSON.stringify({latex: answer}) : null;
  analysis: answer;
  scoringRubric: null;
  defaultScore: draft.defaultScore;
  difficulty: null;
  knowledgePoints: null;
  status: 'generated';
  aiGenerated: true;
}
```

`sourceFileId+sourceQuestionNo` 唯一索引避免同一生成文件重复回填，但不防跨套重复题。

#### 导出

- 查询所有 `generated_paper`。
- 有 LaTeX 引擎：`compileLatexFile()` 编 PDF；失败则保留 TEX。
- 无引擎：复制 TEX 到 `output/`。
- `outputType==='docx'|'md'` 且有 Pandoc：`convertFile()` 从 TEX 转换。
- 生成文件登记为 `project_files(type='final_output')`。
- `result.success` 的条件仅是 `outputFiles.length>0`；仅保留 TEX 也算成功，即使用户要求 DOCX。
- 最后不论结果多少，`workflow.ts` 把状态改为 `done`。

### 3.9 前端显示和下载

- 项目状态/事件：`ProjectWorkspace.tsx` 调 `GET /api/projects/:id` 并建立 `EventSource('/api/projects/:id/events?token=...')`。
- 蓝图：只有 `getBlueprint()` 返回非空且 entries>0 才显示。
- 模板：sections>0 才显示。
- 生成卷：列出 `project.files.type==='generated_paper'`。
- 所有项目文件：统一列出并允许下载。
- 下载接口：`GET /api/projects/:id/download/:fileId` → `upload.ts:downloadFile()`。
- 题目显示：编译阶段成功回填后才会出现在 `/questions`；`QuestionBank.tsx` 通过 `GET /api/questions` 获取。
- 题目编辑：`QuestionEdit.tsx` 把 `answerKey/scoringRubric` 序列化成 JSON TextArea。

## 4. 隔离复现

### 4.1 输入文件

`test-data/test-exam.tex`：高等数学示例，包含 12 个题号和 12 个 `\score{}`。

该 fixture 自身有意或无意存在结构矛盾：各大题标题写 20+20+36+24=100 分，但实际题目数量/`\score{}` 合计 72 分。这可检验系统是否区分“声明分值”和“逐题分值”。

### 4.2 执行命令

```text
npm test
npm run build
npm run lint
npx tsx server/test/.audit-current-flow.ts   # 临时 harness，运行后已从仓库删除
```

临时 harness 的行为：

- `initDb({filePath:null})` 使用内存数据库；
- `mkdtemp()` 使用系统临时目录保存上传和产物；
- 启动随机 localhost 端口的 Express；
- 实际调用项目路由；
- 不读写正式 `server/data/exam-maker.db`。

### 4.3 调用接口

| 顺序 | 接口 | 结果 |
|---:|---|---|
| 1 | `POST /api/projects` | 201 |
| 2 | `POST /api/projects/1/upload` | 201 |
| 3 | `POST /api/projects/1/start` | 200 |
| 4 | `GET /api/projects/1/blueprint` | 200，但 data 为 null（文件未生成） |
| 5 | `POST /api/projects/1/checkpoints/blueprint` | 200，仍允许批准 |
| 6 | `GET /api/projects/1/template` | 200，返回 fallback 模板 |
| 7 | `POST /api/projects/1/checkpoints/template` | 200 |
| 8 | `GET /api/projects/1` | 200，最终 status=`done` |

### 4.4 AI 输入摘要和实际输出

AI 配置检测为 DeepSeek `deepseek-chat`。本次请求在沙箱内报 `fetch failed`；因此：

- AI 输入由上述各 Prompt 构造函数生成并发起发送；包含 fixture 文本片段和项目参数。
- 实际模型输出：**无**。
- 实际输出解析结果：蓝图 0 entries；模板走 heuristic；难度 AI 调整走 fallback；生成卷 0 套。
- 外部联网重跑需要向 DeepSeek 发送真题内容，审批未通过，故模型质量为“需要确认”。

### 4.5 中间和最终结果

- TEX 解析：成功写 `source-test-exam.tex`，885 字符，metadata `verified=false`。
- 蓝图：0 题、0 考点、0/0/0 难度；没有 `blueprint.jsonl/md`，日志却写“已生成”。
- 模板 fallback：4 sections，实际 `\score{}` 合计 72，`verified=false`。
- 难度：基础 33%、中等 0%、难 67%，`passed=false`；日志却称“偏差在可接受范围内”。
- 生成：0/1；错误 `第1套生成失败: fetch failed`。
- 编译：0/0；日志包含“✅ 0/0 套编译/转换完成”。
- 最终：`projects.status='done'`，`generated_paper=0`，`final_output=0`，`questions=0`。

### 4.6 日志和异常

持久日志只有 `job_events.message`，典型记录：

```text
分析 source-test-exam 失败: fetch failed
AI 模板提取失败: fetch failed
AI调整失败: fetch failed, 尝试自动调整...
第1套生成失败: fetch failed
⚠ 0/1 套生成成功
⚠ 未找到生成的试卷文件
✅ 0/0 套编译/转换完成
⏸ 请从生成的试卷中选择要采用的套数并下载
```

没有持久化异常 class、cause、stack、HTTP status/body、AI request ID 或重试次数。外部命令 `pandoc/xelatex/latexmk/tectonic` 不存在的信息出现在 stderr，但不形成结构化 step error。

### 4.7 静默失败与 UI/DB 不一致

确认存在：

1. 蓝图失败返回空结果但流程等待批准，批准接口不检查产物。
2. 生成 0 套不阻断编译。
3. 编译 0/0 不阻断完成。
4. 最终 `done`，前端步骤条来到交付阶段，但数据库无卷、无输出、无题目。
5. `qualityReview()` 若发现问题不会保存 review 文本，属于审查结果静默丢失。
6. `parseGeneratedPaperQuestions()` 对未知 LaTeX 版式返回空数组，不报错；`compilePapers()` 也不会记录“找到生成卷但解析为 0 题”的错误。

## 5. 已有测试能证明和不能证明的内容

### 能证明

- `server/test/questionImporter.test.ts`：一种严格 `section*/subsection*/enumerate` fixture 可切为 3 题并按下标对齐。
- `server/test/paperWorkflowApi.test.ts`：题目 CRUD、审核、人工组卷、分值/顺序、发布后锁定。
- `server/test/examLifecycleE2E.test.ts`：发布、作答、客观判分、主观批改和权限。
- `server/test/validation.test.ts`：选择题至少两个选项、题干非空。

### 不能证明

- 上传后 UI 自动启动。
- PDF/DOCX/OCR 解析正确。
- AI 输出符合格式。
- 历史真题切题与答案对齐。
- 生成卷能被 importer 稳定切题。
- N 套生成、相似度、等价性和不抄真题。
- LaTeX 实际编译。
- DOCX/Markdown 实际生成、打开和三格式一致。
- 失败重试、断点恢复和进程重启恢复。
