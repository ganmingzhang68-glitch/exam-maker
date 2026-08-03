# AI 辅助考试命题系统审计报告

> 审计日期：2026-08-03  
> 审计范围：`client/`、`server/`、`shared/`、现有测试、`test-data/` 与仓库内演示产物。  
> 约束：本阶段未修改正式业务代码；仅执行只读检查、隔离运行和编写报告。

## 1. 结论摘要

当前仓库包含两套彼此连接不完整的能力：

1. `projects/project_files/checkpoints/job_events` 驱动的“文件到 LaTeX 试卷”项目工作流。
2. `questions/papers/exams/attempts/answers` 驱动的题库、组卷、发布和作答系统。

两者只在 `server/src/services/compiler.ts:compilePapers()` 末尾通过 `server/src/services/questionImporter.ts:importGeneratedQuestionsFromProject()` 做一次脆弱的 LaTeX 文本切分。当前核心业务对象实际仍是自由文本 LaTeX，而不是结构化题目或统一试卷对象。

已确认的最高风险问题如下：

- **P0：正常前端流程在上传后停止。** `client/src/pages/ProjectNew.tsx:onFinish()` 创建并上传后直接跳转，没有调用 `startWorkflow()`；`server/src/controllers/upload.ts:handleUpload()` 又把状态改为 `parsing`，而 `client/src/pages/ProjectWorkspace.tsx` 只在 `drafting` 显示“开始出卷”。现有数据库中的项目 2 正处于 `parsing`，仅有上传事件，和该缺陷一致。
- **P0：失败可被标记为完成。** 隔离运行中 AI `fetch failed`，生成结果为 0/1，编译为 0/0，但 `server/src/services/workflow.ts:runWorkflow()` 仍把项目更新为 `done`。前端会显示流程完成，数据库却没有 `generated_paper`、`final_output` 或 `questions`。
- **P0：扫描 PDF 的“AI 视觉识读”没有传 PDF 或页面图像。** `server/src/services/paperParser.ts:parsePdf()` 只把占位字符串传给 `convertToLatex()`；DOCX 的 AI 降级也只传文件名占位符。仓库没有 OCR 引擎或真正的多模态文件输入。
- **P0：题目、答案和评分标准没有可靠对齐。** `server/src/services/questionImporter.ts:parseGeneratedPaperQuestions()` 按“题目 section 下 item 的数组下标”和“答案 subsection 下 item 的数组下标”对齐；格式稍有变化、存在嵌套枚举或缺题即可错位。它不填 `scoringRubric`，也不解析选择题选项。
- **P0：AI 输出无真正 Schema 校验。** 蓝图、模板和难度结果采用手写 `JSON.parse`/正则提取；缺字段会静默补默认值、返回空对象或跳过坏行。生成卷则直接接受自由文本 LaTeX。
- **P1：所谓双向细目表混合了历史统计与目标难度。** 没有历史细目表、目标细目表和生成后实际细目表三类实体；教师只能确认/驳回，不能编辑考点层级、模板或细目表。
- **P1：导出不是基于统一试卷对象。** 生成核心是单个 `.tex` 字符串；DOCX/Markdown 由 Pandoc 从 LaTeX 转换。系统一次只处理项目配置中的一种 `outputType`，没有三格式内容一致性清单。
- **P1：异步执行不是可恢复任务系统。** 只有进程内 Promise、项目单状态和事件日志；没有持久化 step attempt、租约、重试计数、幂等键或断点续跑。`error` 状态下前端“重试”调用 `/start`，但 `runWorkflow()` 对 `error` 没有分支，实际是无操作。

因此，当前系统适合被定义为“可演示的 LaTeX 命题原型 + 基础题库/考试 MVP”，不能认定为已实现目标中的历史真题分析、结构化命题、质量闭环和多格式一致交付。

## 2. 审计方法与验证边界

### 2.1 已执行

- 静态检查全部前后端、共享 Schema、迁移、测试和样例文件。
- `npm test`：12/12 通过；这些测试覆盖权限、基础题库/组卷、考试作答、客观题判分，以及一种固定 LaTeX 导入格式。
- `npm run build`：通过；Vite 报告主 JS chunk 约 1.33 MB 的非阻断警告。
- `npm run lint`：通过。
- 使用 `test-data/test-exam.tex`、内存 SQL.js 数据库和临时目录，实际经 HTTP 调用运行：创建项目、上传、`/start`、两个检查点、生成和编译阶段。
- 对仓库内两份现有 `.tex` 产物调用 `parseGeneratedPaperQuestions()`；两份均解析为 0 题。
- 只读检查当前 `server/data/exam-maker.db`：4 个 migration、2 用户、1 项目、1 项目文件、3 检查点、1 事件、0 题目、1 空试卷。

### 2.2 未验证或需要确认

- 配置显示 AI 为 DeepSeek `deepseek-chat`。隔离流程确实尝试了 AI 请求，但沙箱内得到 `fetch failed`；申请将真题内容发送到外部 DeepSeek 的联网重跑因数据外发风险未获批准。**真实模型输出质量、模型返回兼容性均需要确认。**
- 当前环境未安装 Pandoc、XeLaTeX、latexmk、tectonic；因此当前产品路径下的 DOCX 生成、Markdown 转换和 LaTeX 编译未验证。
- 仓库内已有 `.docx/.pdf/.md/.tex` 产物位于 `智能体大赛/**/exam-build/`，但没有证据表明它们由当前 Web 工作流生成，不能作为当前产品导出能力的验证。
- 未找到浏览器 E2E 测试；前端页面结论为源码检查，未做真实浏览器交互验证。

## 3. 当前架构识别

### 3.1 技术栈

| 层 | 当前实现 | 证据 |
|---|---|---|
| 前端 | React 18 + TypeScript + Vite 5 + Ant Design + React Router + Zustand + Axios | `client/package.json`；路由入口 `client/src/App.tsx:App`；API 客户端 `client/src/services/api.ts` |
| 后端 | Node.js + TypeScript + Express 4 | `server/package.json`；入口 `server/src/index.ts:start()` |
| 数据库 | SQLite 文件，由 SQL.js 在内存加载并整体导出回磁盘 | `server/src/db/index.ts:initDb()/saveToDisk()`；实际文件 `server/data/exam-maker.db` |
| ORM | Drizzle ORM，SQL.js driver | `server/src/db/schema.ts`；`server/src/db/index.ts` |
| 校验 | Zod，主要校验 HTTP 请求；未覆盖 AI 输出 | `shared/schemas.ts` |
| AI SDK/协议 | OpenAI-compatible HTTP `chat/completions` 或 Anthropic SDK | `server/src/services/ai.ts:sendMessage()/sendOpenAI()/sendAnthropic()` |

`server/src/services/claude.ts` 是另一套固定 Anthropic 模型的旧封装，当前没有任何 import，属于未使用代码。

### 3.2 文件上传入口

- 前端：`client/src/pages/ProjectNew.tsx:onFinish()` → `client/src/services/project.ts:uploadPapers()`。
- HTTP：`POST /api/projects/:id/upload`，路由在 `server/src/routes/project.ts`。
- Multer：`server/src/controllers/upload.ts:uploadPastPapers`，字段名 `files`，最多 20 个、单文件 50 MB。
- 保存：`multer.diskStorage` 写到 `server/data/projects/<projectId>/past_papers/`（运行目录为 `server/` 时），数据库插入 `project_files(type='past_paper')`。
- 支持声明：PDF、DOCX、DOC、TEX、MD、TXT；**不支持独立图片上传**，`ALLOWED_TYPES` 没有 PNG/JPEG。

### 3.3 文本提取和 OCR

| 格式 | 当前路径 | 实际判断 |
|---|---|---|
| PDF | `paperParser.ts:parsePdf()` → `pdf-parse` 的 `PDFParse.getText()` | 可提取 born-digital PDF 的合并文本；没有保留题目页码、坐标和图片引用 |
| DOCX | `paperParser.ts:parseDocx()` → 外部 `pandoc` | 当前环境无 Pandoc；降级路径不读取 DOCX 内容，只给 AI 一个文件名占位符，实际不可用 |
| DOC | `paperParser.ts:parseDoc()` → LibreOffice 转 DOCX → Pandoc | 当前环境无 LibreOffice/Pandoc；失败时生成带 `% ERROR` 的 LaTeX 文本，但仍可被上层计为解析成功 |
| TEX | `paperParser.ts:parseTex()` | 直接读文本；有 `document` 时取正文 |
| MD/TXT | `paperParser.ts:parseMd()` | 有 Pandoc则转 TEX，否则直接作为文本返回 |
| 图片 | 无上传类型、无 parser | 完全缺失 |

OCR 结论：**不存在 OCR 实现。** PDF 文本少于 50 字时，`parsePdf()` 记录“AI视觉识读”，但调用 `convertToLatex('[PDF文件：...请直接读取此PDF...]')`，`ai.ts:sendMessage()` 只支持字符串消息，没有文件、base64、URL或图像 content block。该路径是实现错误，而非可用 OCR。

另外，`paperParser.ts:verifyParsed()` 对 PDF/DOCX/DOC 直接设置 `verified=true`，理由是“二进制格式无法逐字比对”。这会造成未经验证的解析被标记已核对。

### 3.4 AI 调用入口与参数

- 活跃入口：`server/src/services/ai.ts:sendMessage()`。
- Provider：`AI_PROVIDER=anthropic` 时走 `sendAnthropic()`；否则走 `sendOpenAI()`。
- 当前 `.env`（密钥未读取到报告）：provider `deepseek`，model `deepseek-chat`，base URL `https://api.deepseek.com/v1`。
- OpenAI-compatible 请求固定 `temperature: 0.7`，`max_tokens` 由调用方或环境决定，超时默认 180 秒。
- 没有 seed、top_p、response_format、JSON Schema、tool calling、请求 ID、token usage、成本、prompt hash 或模型响应元数据持久化。
- Anthropic 路径同样只取第一个 text block，丢弃 usage、stop reason 和 response ID。

### 3.5 Prompt 清单

活跃产品代码没有独立 Prompt 文件；全部为内联字符串。

| 阶段 | Prompt 位置/构建函数 | 期望输出 |
|---|---|---|
| 文档转 LaTeX | `paperParser.ts:convertToLatex()` | 自由文本 LaTeX |
| 转写校对 | `paperParser.ts:verifyParsed()` | 含 `VERDICT: PASS` 的自由文本 |
| 逐题考点分析 | `blueprint.ts:buildAnalyzePrompt()` / `analyzeQuestions()` | JSONL |
| 蓝图核对 | `blueprint.ts:verifyBlueprint()` | 自由文本 + `VERDICT` |
| 模板提取 | `template.ts:aiExtractTemplate()` | JSON |
| 模板核对 | `template.ts:verifyTemplate()` | 自由文本 + `VERDICT` |
| 难度微调 | `difficultyAssigner.ts:tryAdjustWithAI()` | JSON |
| 新卷生成 | `paperGenerator.ts:buildSystemPrompt()` + `buildUserPrompt()` | 单个自由文本 LaTeX，题目、答案、评分标准和命题说明一起生成 |
| 计算验算 | `paperGenerator.ts:runVerification()` | 自由文本 + `TOTAL: passed/total` |
| 质量审核 | `paperGenerator.ts:qualityReview()` | 自由文本 + `REVIEW` |
| 导出核对 | `compiler.ts:verifyConversion()` | 自由文本 + `VERIFY` |
| 旧生成路径 | `workflow.ts:buildPaperPrompt()` | 自由文本 LaTeX；其调用者 `step5GeneratePapers()` 当前未被主流程使用 |

`智能体大赛/exam-maker/SKILL.md` 及 `智能体大赛/**/exam-build/*.py` 是仓库附带的离线材料/脚本，没有被 `server/src` 或 `client/src` 导入，不能算作 Web 系统 Prompt 或功能。

### 3.6 当前题目生成接口

没有独立的“生成题目”HTTP 接口。当前生成是项目级工作流：

- `POST /api/projects/:id/start` → `project.ts:startProjectWorkflow()` → `workflow.ts:startWorkflow()`。
- 生成阶段：`workflow.ts:runWorkflow()` 的 `generating` 分支 → `paperGenerator.ts:generatePapers()`。
- 生成对象是 N 份 `.tex` 文件，而不是 N 份结构化 `Paper` 或 `Question[]`。
- 编译阶段才调用 `questionImporter.ts:importGeneratedQuestionsFromProject()` 将部分 LaTeX 题目回填 `questions`。

题库的 `POST /api/questions` 是教师手工创建题目接口，`question.ts:createQuestion()` 固定写 `aiGenerated=false`，不调用 AI。

### 3.7 当前题目数据结构

结构定义在 `shared/types.ts:Question`、请求校验在 `shared/schemas.ts:questionFieldsSchema`、表在 `server/src/db/schema.ts:questions`：

- 基础：`type`、`stem:string`、`options:string[]|null`、`answerKey:Record|null`、`analysis:string|null`、`scoringRubric:Record|null`、`defaultScore`。
- 分类：`difficulty: basic|medium|hard|null`、`knowledgePoints:string[]|null`。
- 状态：`generated|reviewed|rejected`、`aiGenerated:boolean`。
- 来源：`sourceFileId`、`sourceProjectId`、`sourceQuestionNo`、自由 `metadata`。

缺失：稳定的题目版本、题源类别、教师修订者/修订历史、页码/区域、原始题号层级、子题树、内容 block、图片/表格/代码资产、公式 AST、答案类型化 Schema、评分项数组、难度三分法（预测/教师/实测）、AI run 外键和 prompt/model 版本。

`createQuestionSchema` 只要求选择题至少 2 个选项，不检查答案引用的选项是否存在、单选是否恰好一个答案、多选答案是否唯一，也不检查 rubric 分值之和。

### 3.8 相关数据表

| 表 | 定义 | 用途与问题 |
|---|---|---|
| `users` | `schema.ts:users` | 用户/角色 |
| `projects` | `schema.ts:projects` | 项目参数和单一总状态 |
| `project_files` | `schema.ts:projectFiles` | 原文件、中间 Markdown/JSON/TEX、输出文件混存；metadata 为 JSON 文本 |
| `checkpoints` | `schema.ts:checkpoints` | blueprint/template/selection 的批准状态；无被批准对象版本 |
| `job_events` | `schema.ts:jobEvents` | 事件日志；无 attempt、stack、retry、duration、input/output 引用 |
| `questions` | `schema.ts:questions` | 题库题目 |
| `papers` | `schema.ts:papers` | 人工组卷的基本信息；与项目生成的 `.tex` 不是同一对象 |
| `paper_questions` | `schema.ts:paperQuestions` | 题目顺序/分值/快照 |
| `exams` | `schema.ts:exams` | 发布考试 |
| `exam_assignments` | `schema.ts:examAssignments` | 考试分配 |
| `attempts` | `schema.ts:attempts` | 作答尝试与发布快照 |
| `answers` | `schema.ts:answers` | 学生答案和评分结果 |

没有课程、考点树、题目版本、题源定位、历史分析、三类细目表、模板版本、生成计划、标准试卷对象、质量检查、相似度、AI 调用或持久任务表。

### 3.9 前端展示和编辑

- 项目创建/上传：`client/src/pages/ProjectNew.tsx:ProjectNew`。
- 工作流中间产物、日志和文件：`client/src/pages/ProjectWorkspace.tsx:ProjectWorkspace`。
- 题库列表/审核：`client/src/pages/QuestionBank.tsx:QuestionBank`，路由 `/questions`、`/questions/review`。
- 题目编辑：`client/src/pages/QuestionEdit.tsx:QuestionEdit`，路由 `/questions/:id/edit`。
- 人工试卷列表/编辑：`client/src/pages/PaperList.tsx:PaperList`、`PaperEdit.tsx:PaperEdit`，路由 `/papers`、`/papers/:id`。

蓝图和模板页面仅展示并提供“确认/驳回”，没有修改/合并考点、改题位、改分值或编辑目标细目表的控件。题干、答案和 rubric 作为 TextArea/JSON 文本编辑；没有 LaTeX/Markdown 数学渲染器，也没有子题/图片/表格编辑器。

### 3.10 Markdown、DOCX、LaTeX 导出

- 生成源：`paperGenerator.ts:wrapInDocument()` 生成 `.tex`。
- LaTeX/PDF：`compiler.ts:compileLatexFile()` 探测 XeLaTeX/latexmk/tectonic；有引擎才实际编译 PDF，否则只复制 `.tex`。
- DOCX/Markdown：`compiler.ts:convertFile()` 先做少量正则替换，再由 Pandoc 从 `.conv.tex` 转换。
- 调度：`compiler.ts:compilePapers(projectId, outputType)`；项目只能选择 `latex|docx|md` 之一。

内容来源虽然共同来自 LaTeX 字符串，但不是统一结构化试卷对象。`convertFile()` 的分值丢失检查还有实现错误：`origScores` 对 `texPath` 路径字符串执行正则，而不是对源码内容执行，通常得到 0，无法发现丢分值。

### 3.11 异步、重试和状态

- 异步：`project.ts:startProjectWorkflow()` 和 `updateCheckpoint()` 在发送响应后直接启动 Promise。
- 状态：`projects.status` 的 `drafting/parsing/.../done/error`。
- 日志：`project.ts:addEvent()` 写 `job_events` 并广播 SSE；`GET /api/projects/:id/events`。
- 容错：解析阶段按文件 catch；生成阶段按套 catch；部分 AI 辅助步骤降级启发式。
- 重试：无统一重试、退避或 AI 输出修复；前端“重试”没有可执行的 error 分支。
- 断点：状态分支可从某些正常状态继续，但没有 step attempt/idempotency；崩溃后是否安全继续需要确认，重复执行可能生成重复文件/记录。
- 失败保存：部分文件成功会被保留，但项目级成功判定错误，且没有“部分成功”状态或失败套数的可重跑 API。

## 4. 隔离复现结果

完整逐步记录见 [question-generation-current-flow.md](./question-generation-current-flow.md)。关键结果：

| 项目 | 实际结果 |
|---|---|
| 输入 | `test-data/test-exam.tex`，12 个题号，标题声明的小计合计 100，但实际只有 12 个 `\score{}`、合计 72；可用于检测结构矛盾 |
| 命令 | `npm test`、`npm run build`、`npm run lint`；另用临时测试 harness 启动 Express + 内存 SQL.js，经 HTTP 调接口 |
| 接口 | `POST /projects`、`POST /projects/1/upload`、`POST /projects/1/start`、`GET /blueprint`、两个 checkpoint POST、`GET /template`、`GET /projects/1` |
| AI 输入摘要 | 转写校对：原 TEX 与转写 TEX；蓝图：最多 10,000 字 TEX；模板：最多 5,000 字/文件；生成：模板、蓝图、难度 JSON、首份真题前 2,000 字、防重台账 |
| AI 输出 | 实际均无模型输出，调用报 `fetch failed`；预期格式分别为自由文本 verdict、JSONL、JSON、LaTeX |
| 最终题目 | 0 题；`questions` 表为空 |
| 错误 | 蓝图分析、模板提取、难度微调、试卷生成均 `fetch failed`；环境无 Pandoc/LaTeX |
| 日志/堆栈 | `job_events` 只保存错误 message，不保存异常类型、cause 或 stack；终端仅见外部命令不存在，不见 AI fetch 的堆栈 |
| 静默失败 | 是：蓝图 0 题仍标记“已生成”；生成 0/1 后继续；编译 0/0 后标记完成；最终状态 `done` |
| 前端/数据库错觉 | 是：`done` 会让步骤条走到交付阶段，但数据库中 `generated_paper=0`、`final_output=0`、`questions=0` |

额外复现：`parseGeneratedPaperQuestions()` 对 `智能体大赛/exam1/exam-build/paper-1.tex` 和 `智能体大赛/exam/exam-build/paper-1.tex` 均返回 0 题，因为导入器要求严格的 `\section*{试题}`、题型 `\section*{...}`、答案 `\subsection*{...}` 组合，而这些产物格式不同。该失败没有异常。

## 5. 30 项重点架构检查

| # | 检查 | 结论 | 证据/影响 |
|---:|---|---|---|
| 1 | 一个大型 Prompt 同时做所有任务 | **部分是** | 已有蓝图/模板/生成/审核多个调用；但 `paperGenerator.ts:buildSystemPrompt()` 仍一次生成题目、答案、rubric 和说明，核心生成过载 |
| 2 | 缺少分阶段流水线 | **部分实现但边界错误** | `workflow.ts:runWorkflow()` 有 0-6 阶段，但没有题目切分、答案对齐、规范化、历史分析、计划、实际细目表等持久阶段 |
| 3 | 自由文本/Markdown 为核心数据 | **是，高风险** | 蓝图/模板主要写文件，生成核心是 `.tex`；数据库没有 canonical paper |
| 4 | AI 输出 Schema 校验 | **缺失** | 手写 `parseJsonl()/parseJson()`；Zod 只用于 API 请求 |
| 5 | 输出错误重试/修复 | **缺失** | 无 retry；坏 JSON 被跳过/补默认；生成 LaTeX 不修复 |
| 6 | 来源文件/页码/原题号 | **部分** | `sourceFileId/sourceQuestionNo` 存在；无 page/bbox，且生成题 source 指向生成 `.tex`，不指历史材料 |
| 7 | 真题/生成题/教师修改题区分 | **实现错误** | 只有 `aiGenerated`；手工修改 AI 题不会记录 revision/source kind；真题没有进入 `questions` |
| 8 | 题目答案错位 | **可能且高风险** | `questionImporter.ts` 以 section index/item index 对齐 |
| 9 | 多选选项/答案一致 | **未保证** | Schema 只检查选项数；导入器不抽取 options |
| 10 | 分值/rubric 合计 | **未保证** | rubric 无 typed items；生成导入不写 rubric；质量 review 不阻断 |
| 11 | 子题/组合题/公式/表格/图片/代码 | **基本不支持** | `stem:string`；公式仅原始 LaTeX；无结构化子题/资产；图片只留注释意图 |
| 12 | 所有课程当纯文本处理 | **是** | 相同文本 prompt 和 LaTeX pipeline；`verifyMode` 仅影响是否调用 AI 验算 |
| 13 | 考点分类写死某课程 | **部分写死** | 蓝图考点由 AI动态给出，但 heuristic 是“待分类”；`paperGenerator.ts:extractKp()` 硬编码微积分/线代/概率词表 |
| 14 | 新课程自动考点层级 | **缺失** | 仅扁平 `kp` 名称并重编号 K1... |
| 15 | 教师修改/合并考点 | **缺失** | 只有 checkpoint approve/reject API 和按钮 |
| 16 | 难度是否随意 easy/medium/hard | **是，且标签为 basic/medium/hard** | 历史难度由 AI主观判断；无可解释特征/校准数据；fallback 按位置猜 |
| 17 | 预测/教师/实测难度区分 | **缺失** | 单一 `questions.difficulty` |
| 18 | 历史/目标/实际细目表 | **缺失** | 只有一个 `blueprint.jsonl/md`，还混用项目目标难度 |
| 19 | 模板只视觉不结构 | **相反但仍不完整** | `template.ts` 提取题型/数量/分值/时长，而非纯视觉；但不建 section/slot 稳定实体，也不分析跨年模板版本 |
| 20 | N 套重复/近似检测 | **实现错误** | 只有 prompt 台账和正则猜测的轴；无题干相似度/语义检测/跨套 gate |
| 21 | 新题复制真题 | **可能** | Prompt 说“不抄”，但只给首份真题片段且无生成后相似度检查 |
| 22 | 答案独立验证 | **部分且不可靠** | computational 模式下同一 AI做 `runVerification()`；其他模式不验；结果不阻断也不修正 |
| 23 | 主观题逐项评分标准 | **Prompt 要求，数据未实现** | 生成文本可能含评分说明；导入器不写 `scoringRubric` |
| 24 | 三格式同一统一对象 | **否** | 同一 LaTeX 字符串派生，但没有统一标准试卷对象 |
| 25 | 三格式内容不一致 | **可能** | 正则 + Pandoc 转换；一致性仅截断文本给 AI，且未实际验证 |
| 26 | LaTeX 编译验证 | **有代码，当前未验证** | `compiler.ts:compileLatexFile()`；本机无引擎 |
| 27 | DOCX 生成/可打开 | **有代码，当前未验证** | 依赖 Pandoc；本机无 Pandoc；无打开/ZIP 完整性测试 |
| 28 | Prompt/模型/参数记录 | **缺失** | event 只记录 provider/model 环境摘要；无 prompt version、temperature、response ID/usage |
| 29 | 一次失败是否全丢 | **部分保留但状态错误** | 按文件/按套 catch 可保留成功项；没有 partial 状态，0 成功也进入 done |
| 30 | 断点继续 | **不可靠/基本缺失** | 正常 checkpoint 可继续；error 重试无效，无 attempt/idempotency，进程崩溃恢复未实现 |

## 6. 与目标系统的模块差距

状态定义：

- **已正确实现**：结构和业务闭环基本符合目标，且本次实际验证。
- **部分实现**：存在可复用代码，但关键结构、校验或闭环缺失。
- **实现错误**：表面存在功能，但当前实现不能可靠完成目标或产生误导状态。
- **完全缺失**：未找到对应数据、服务和 UI。

| # | 模块 | 状态 | 说明 |
|---:|---|---|---|
| 1 | 文档导入 | 部分实现 | 上传与磁盘/DB登记存在；图片缺失，UI 上传后不启动 |
| 2 | OCR和内容提取 | 实现错误 | PDF文本提取可用；OCR/视觉和 DOCX AI fallback 是占位符 |
| 3 | 文档结构识别 | 部分实现 | AI/启发式转 LaTeX，但不保留页/块/资产结构 |
| 4 | 真题题目切分 | 完全缺失 | 历史真题未切为结构化题；导入器只处理生成卷 |
| 5 | 题目与答案对齐 | 实现错误 | 仅生成卷的数组下标对齐；真题答案导入链路无 |
| 6 | 题目规范化 | 完全缺失 | 无 canonical question/version/content blocks |
| 7 | 考点体系生成 | 部分实现 | AI扁平考点列表；无层级、版本和教师治理 |
| 8 | 考点分类 | 部分实现 | AI JSONL 分类；无 Schema/置信度/人工修订记录 |
| 9 | 历史命题分析 | 部分实现 | 只有考点频次/分值聚合，没有跨年趋势、题型/认知/重复规律报告 |
| 10 | 历史双向细目表 | 部分实现 | `blueprint` 为考点×难度聚合，但混入目标难度且不是持久实体 |
| 11 | 试卷结构模板提取 | 部分实现 | 提取题型/题量/分值/时长；无模板版本、跨年共识和 slot 实体 |
| 12 | 目标细目表编辑 | 完全缺失 | 仅查看和批准/驳回 |
| 13 | 命题计划生成 | 部分实现 | `difficulty.json` 有题位难度；没有知识点×题型×分值×来源约束计划 |
| 14 | 新题生成 | 实现错误 | 生成自由 LaTeX；失败可进入 done；无结构化题输出 |
| 15 | 参考答案生成 | 部分实现 | 与题目同次文本生成；入库为宽松 `{latex}`，无独立生成/验证 |
| 16 | 评分标准生成 | 实现错误 | Prompt 要求但导入不写 rubric，无法逐项计分校验 |
| 17 | 质量校验 | 实现错误 | AI review/verification 不阻断、不修复，失败被吞，缺硬性规则 |
| 18 | N套试卷等价性校验 | 完全缺失 | 无难度/覆盖/题型等价统计比较 |
| 19 | 重复度检测 | 实现错误 | 只有 prompt 台账，没有真正相似度计算 |
| 20 | 教师审核 | 部分实现 | 可审核题目、批准蓝图/模板；但中间产物不可编辑，无版本审计 |
| 21 | Markdown导出 | 部分实现 | 有 Pandoc 路径；当前环境未验证，非统一对象渲染 |
| 22 | LaTeX导出 | 部分实现 | `.tex` 生成/复制代码存在；实际生成未成功，编译环境缺失 |
| 23 | DOCX导出 | 部分实现 | 有 Pandoc 路径；当前环境未验证，不能声称可打开 |

本次没有任何模块达到“已正确实现”的严格标准；这不是说所有代码都不可用，而是目标流程所要求的结构化、可追溯、可恢复和已运行验证条件尚未同时满足。

## 7. 建议优先级

1. 先修 P0 控制流和成功判定：上传后启动、无产物不得 done、error 可重试、每步产物/状态原子化。
2. 建立 canonical schema 和持久 step attempt；把“真题切分→答案对齐→规范化”放在任何历史分析之前。
3. 把考点体系、历史/目标/实际细目表和模板变为可编辑、可版本化实体。
4. 将生成改成按命题计划输出结构化题目；答案/rubric 独立生成与验证。
5. 最后接统一渲染器、相似度/等价性检查和三格式验收。

目标架构见 [question-generation-target-architecture.md](./question-generation-target-architecture.md)，文件级实施计划见 [question-generation-repair-plan.md](./question-generation-repair-plan.md)。
