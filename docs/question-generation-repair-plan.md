# 题目生成修复计划

> 本计划复用 React、Ant Design、Express、TypeScript、Drizzle、SQL.js/SQLite 和 Zod。  
> 不删除现有上传、项目、题库、组卷、考试、作答和导出代码；采用兼容适配和分阶段替换。  
> 实施分支：`fix/question-generation-pipeline`。以下状态仅以已提交代码和实际运行结果为准。

## 实施状态

| 顺序 | 阶段 | 状态 | 已验证结果 |
|---|---|---|---|
| 1 | 统一数据模型和 Schema | 已完成（2026-08-03） | 新增共享 Zod 领域模型、Drizzle 表定义、`005_question_generation_domain` 兼容 migration；全量 20 项测试、全仓 build、lint 均通过 |
| 2 | 真题解析和答案对齐 | 未开始 | — |
| 3 | 考点体系与分类 | 未开始 | — |
| 4 | 模板和细目表 | 未开始 | — |
| 5 | GenerationPlan | 未开始 | — |
| 6 | 生成、答案和评分标准 | 未开始 | — |
| 7 | 校验 | 未开始 | — |
| 8 | 统一导出 | 未开始 | — |
| 9 | 前端接入 | 未开始 | — |
| 10 | E2E fixture 与测试 | 未开始 | — |

Prompt 专项（2026-08-04）：已完成全部旧 Prompt 审计，建立 12 个版本化单职责 Prompt、严格 Zod 输入输出、正确/异常示例、注入边界和自动化测试；活跃业务调用已收口到 `promptRunner.ts`。PromptVersion/AiRun 持久化以及答案对齐、蓝图生成阶段的正式接入仍待后续步骤。

第一步实现文件：`shared/questionGeneration.ts`、`server/src/db/schema.ts`、
`server/src/db/migrations/005_question_generation_domain.ts`。旧表和旧字段均保留；旧项目、
往年卷文件、AI 题和生成卷文件通过兼容引用映射到新领域表。API 与页面尚未在第一步接入。

## 1. 根因列表与风险等级

风险定义：P0 会阻断主流程、产生错误交付或数据错配；P1 会严重降低可靠性/可追溯性；P2 是中期可维护性或体验问题。

| ID | 风险 | 根因 | 已观察后果 | 首要修复 |
|---|---|---|---|---|
| RC-01 | P0 | UI 创建上传后不调用 `/start`，上传又把状态改为 `parsing` | 教师流程停在上传后，工作区无启动按钮 | 明确“创建/上传/启动”状态机；上传完成自动启动或始终提供启动按钮 |
| RC-02 | P0 | 顶层工作流不检查阶段有效产物和最小成功数 | AI失败后 0/1 生成、0/0 编译仍 `done` | 每步 output gate；0 产物失败；完成条件集中计算 |
| RC-03 | P0 | 扫描 PDF/DOCX fallback 没有实际传文件内容/图像 | “AI视觉识读”名义存在但不可工作 | 真正的 extractor/OCR adapter；未支持时明确失败 |
| RC-04 | P0 | AI 输出用自由文本和手写 JSON 正则解析，无 Zod Schema | 坏行跳过、缺字段补空值、空蓝图继续 | 为每任务建立 Zod output schema、repair/retry、失败阻断 |
| RC-05 | P0 | 题目/答案/rubric 在同一 LaTeX 中生成，靠 section/item 下标回填 | 答案错位、0题静默导入、rubric 丢失 | 生成结构化题目；答案/rubric 分阶段；稳定 ID 对齐 |
| RC-06 | P0 | 错误日志只保留 message，error 状态没有可执行恢复语义 | 无 stack/cause；前端“重试”是 no-op | `step_runs` + attempt/retry/stack；指定 step 重跑 |
| RC-07 | P1 | 历史真题没有先切成 canonical question | 后续考点/历史规律基于文本片段而非题库事实 | 增加切题、答案切分、对齐、规范化阶段 |
| RC-08 | P1 | 项目文件承担所有中间业务对象 | 无版本、无引用完整性、批准无法绑定对象 | 结构化实体入库；文件仅作原始/渲染 artifact |
| RC-09 | P1 | 只有一个蓝图概念，混合历史分析和目标比例 | 无 historical/target/actual 闭环 | 三类版本化细目表；生成后反算 actual |
| RC-10 | P1 | 考点是 AI 生成的扁平字符串 | 无课程层级、合并、别名、教师治理 | `knowledge_nodes` 树和版本；可编辑 UI/API |
| RC-11 | P1 | 难度只有 basic/medium/hard 单字段 | 预测、教师和实测难度混淆 | 三类难度字段/表，标签和统计口径分开 |
| RC-12 | P1 | 生成计划不是稳定的 slot 约束 | AI 可自行改变题量、分值、考点 | 由 target blueprint + template 生成 slot plan |
| RC-13 | P1 | 质量审核是同模型自由文本，且不阻断/不保存失败 | 有问题卷仍可交付 | 硬规则优先；所有 review 结果持久化；失败阻断 |
| RC-14 | P1 | 防重仅靠 prompt 台账和关键词/随机猜轴 | N套近似题、复制真题无法检测 | exact/normalized/near-duplicate gate + 历史库比较 |
| RC-15 | P1 | LaTeX 字符串是事实源，导出一次只选一种格式 | 三格式不可证明一致；DOCX/编译未验 | 统一 `CanonicalPaper`，纯 renderer，多格式 manifest |
| RC-16 | P1 | 来源只到文件和原题号，没有页/区域/version | 无法审阅 OCR、无法追溯生成依据 | page/bbox/extraction run/source locator |
| RC-17 | P1 | 教师 checkpoint 只有 approve/reject | 不能直接修考点、模板、目标表；驳回不触发带意见重跑 | 可编辑版本化页面和 API；批准绑定 version |
| RC-18 | P2 | Prompt 内联、旧路径并存 | Prompt 无版本，`workflow.ts` 有未使用生成函数，维护歧义 | Prompt registry；标记 legacy，分阶段移除死路径 |
| RC-19 | P2 | 外部工具探测和执行散落，错误进入 stderr | 环境问题不可结构化诊断 | `toolchain` adapter + structured result |
| RC-20 | P2 | 当前测试偏题库/考试，缺生成链路 | 控制流、导入、导出回归未被发现 | 增加 pipeline integration、fixture、failure injection 和 export tests |

## 2. 修复边界

### 保留

- `client` 的 React/Vite/Ant Design/Router/Zustand/Axios。
- `server` 的 Express、鉴权、中间件、Drizzle、SQLite/SQL.js。
- `shared` 的 Zod/TypeScript 共享 Schema 模式。
- 上传、项目列表、题库审核、人工组卷、发布考试和作答功能。
- 已有文件下载和 LaTeX/Pandoc 工具链作为 renderer 的一部分。

### 不做

- 不在第一阶段更换 PostgreSQL、引入微服务或新前端框架。
- 不一次性删除旧字段或旧接口。
- 不把三种导出分别交给 AI。
- 不把尚无学生数据的难度称为“实际难度”。
- 不用大规模 UI 重写掩盖后端数据问题。

## 3. 文件级修改计划

### 3.1 第一阶段：控制流和真实成功判定

| 文件 | 计划 |
|---|---|
| `client/src/pages/ProjectNew.tsx` | 上传成功后显式调用 `startWorkflow(project.id)`，或把按钮文案改为“创建项目”并在工作区始终提供可启动动作；选择一种一致业务规则 |
| `client/src/pages/ProjectWorkspace.tsx` | `parsing` 且无 active run 时显示“继续/启动”；完成页显示有效生成数、所需导出成功数；0 产物显示错误而非完成 |
| `server/src/controllers/upload.ts` | 上传只登记文件；是否改变项目状态由统一 pipeline service 决定；补充文件扩展名/实际 MIME 校验结果 |
| `server/src/controllers/project.ts` | `/start` 创建持久 pipeline run；checkpoint 批准前检查目标对象/version；新增 step retry handler |
| `server/src/services/workflow.ts` | 将每步成功条件显式化；`successCount===0`、蓝图空、模板空、所需导出缺失必须失败；移除“失败也继续”路径；error 可从失败 step 重跑 |
| `server/src/services/paperGenerator.ts` | 返回 batch summary；失败 review 持久化；没有通过质量 gate 不写可交付状态 |
| `server/src/services/compiler.ts` | 修正 `origScores` 对路径字符串执行正则的 bug；区分 requested format success 与仅保留 TEX；0 papers 返回失败 |
| `shared/types.ts` / `shared/schemas.ts` | 增加过渡期 `PipelineStatus`、`StepStatus`、batch summary DTO |

### 3.2 第二阶段：提取、切题和对齐

| 文件/新模块 | 计划 |
|---|---|
| `server/src/services/paperParser.ts` | 拆为 format dispatcher；删除假视觉/假 DOCX fallback；返回逐页/逐 block 结构和置信度 |
| `server/src/services/extraction/pdfExtractor.ts` | PDF 按页文本提取，保留 page；检测扫描页 |
| `server/src/services/extraction/docxExtractor.ts` | Pandoc 路径保留；增加真正读取内容的 fallback；转换失败明确 failed |
| `server/src/services/extraction/ocrExtractor.ts` | 实际携带页面图像调用 OCR/vision adapter；保留 OCR 置信度和 bbox |
| `server/src/services/questionSegmentation.ts` | 从文档结构切历史题，输出带 source locator 的 draft |
| `server/src/services/answerSegmentation.ts` | 独立切答案/评分说明 |
| `server/src/services/answerAlignment.ts` | 使用原题号、section、顺序和语义生成候选；低置信项进入人工审核 |
| `server/src/services/questionNormalizer.ts` | 把 draft 转 canonical question version，保留原文和转换 issue |
| `shared/schemas/content.ts` | ContentBlock、asset、source locator Schema |
| `shared/schemas/questionGeneration.ts` | CanonicalQuestion、AnswerSpec、RubricItem Schema |

现有 `server/src/services/questionImporter.ts` 保留为 legacy importer，只用于旧 `.tex`；增加显式结果 `{parsed, imported, rejected, issues}`，0 题必须报告问题，不能静默。

### 3.3 第三阶段：考点、历史分析、模板和细目表

| 文件/新模块 | 计划 |
|---|---|
| `server/src/services/blueprint.ts` | 拆为 taxonomy proposal、classification、historical statistics；不再把目标比例传入历史分析 |
| `server/src/services/knowledgeTaxonomy.ts` | 生成树、别名、合并和版本管理 |
| `server/src/services/historicalAnalysis.ts` | 按年份/试卷/考点/题型/分值/认知/预测难度统计 |
| `server/src/services/template.ts` | 输出稳定 template/section/slot Schema；支持多份历史卷的模板版本/共识，而非拼接一次提取 |
| `server/src/services/targetBlueprint.ts` | 校验教师目标表、容差、必考/禁考规则 |
| `server/src/services/generationPlan.ts` | 将模板+目标表求解为每 slot 的约束；不让 AI改变结构 |
| `server/src/services/difficultyAssigner.ts` | 改为计划求解器的一部分；修复当前位置 heuristic；字段明确为 predicted difficulty |
| `shared/schemas/knowledge.ts` | KnowledgeNode/TreeVersion Schema |
| `shared/schemas/blueprint.ts` | historical/target/actual Blueprint Schema |
| `shared/schemas/paperTemplate.ts` | Template/Section/Slot/GenerationPlan Schema |

### 3.4 第四阶段：结构化生成、验证和 N 套质量

| 文件/新模块 | 计划 |
|---|---|
| `server/src/services/paperGenerator.ts` | 改为按 `GenerationSlot` 逐题生成结构化 JSON，不直接生成整份 LaTeX |
| `server/src/services/answerGenerator.ts` | 冻结题面后独立生成答案/解法 |
| `server/src/services/rubricGenerator.ts` | 生成 typed rubric items，并确定性校验合计 |
| `server/src/services/answerVerifier.ts` | 客观规则、符号/数值工具和独立 AI reviewer；结果阻断 |
| `server/src/services/paperAssembler.ts` | 把通过的题目版本装入 `CanonicalPaper` |
| `server/src/services/actualBlueprint.ts` | 从实际试卷反向计算 actual blueprint，比较 target |
| `server/src/services/similarity.ts` | 历史+批次 exact/normalized/near-duplicate 检测 |
| `server/src/services/equivalence.ts` | N套结构、覆盖、难度、阅读/计算 proxy 等价性报告 |
| `server/src/services/quality.ts` | 汇总硬规则和 AI 软审查；质量问题结构化、可定位、可重跑 |

### 3.5 第五阶段：统一导出

| 文件/新模块 | 计划 |
|---|---|
| `server/src/services/compiler.ts` | 退化为工具链执行器，不再承担题目回填和业务装配 |
| `server/src/renderers/markdownRenderer.ts` | 从 canonical paper 纯函数生成 Markdown |
| `server/src/renderers/latexRenderer.ts` | 从同对象生成 LaTeX；统一 preamble/template |
| `server/src/renderers/docxRenderer.ts` | 从同对象生成 DOCX 或从统一中间表示转换 |
| `server/src/services/exportVerifier.ts` | 题目数/分值/答案/rubric/资源清单一致性；LaTeX编译、DOCX重新打开检查 |
| `server/src/registerOutputs.ts` | 迁移为 artifact repair/admin 脚本，写明来源 paper version 和 renderer version |

### 3.6 AI 基础设施和 Prompt

| 文件/新模块 | 计划 |
|---|---|
| `server/src/services/ai.ts` | 支持 structured output 能力探测、调用 metadata、超时分类、可重试错误、usage/response id；消息支持图像时需 typed content blocks |
| `server/src/services/claude.ts` | 标记 deprecated，迁移调用后删除；删除前确认无外部脚本依赖 |
| `server/src/prompts/*.ts` | 每任务一个版本化 prompt definition，绑定 input/output Zod Schema |
| `server/src/services/aiRunRecorder.ts` | 记录 prompt/model/参数/输入输出 artifact/错误，不记录 secret |

## 4. 数据库修改计划

所有变更使用新 migration；统一领域模型已落在 `005_question_generation_domain.ts`，后续按编号追加，不回写或删除旧 migration。

### 4.1 管道和 AI 运行

- `pipeline_runs`：project、pipeline version、聚合状态、发起人、时间。
- `step_runs`：step key、attempt、输入/输出版本引用、状态、进度、lease/heartbeat、错误 code/message/stack、retryable。
- `ai_runs`：task、prompt key/version/hash、provider/model、生成参数、request/response id、usage、状态、错误、输入/输出 artifact 引用。
- `artifacts`：kind、path、mime、content hash、schema version、producer step、validation status。

### 4.2 文档和提取

- `source_documents`：原文件、课程、文档类型（试题/答案/混合/大纲）、hash、页数。
- `document_pages`：页码、提取模式、text、confidence、image asset。
- `content_blocks`：page、order、type、内容 JSON、bbox、confidence。
- `extraction_issues`：issue code、severity、page/block、状态、教师修正。

### 4.3 题目和版本

保留 `questions`，新增：

- `question_versions`：question id、version、origin、canonical JSON、created_by、ai_run、review status。
- `question_sources`：question version、document、page range、bbox、original question no、excerpt hash。
- `question_relations`：parent/child、variant-of、derived-from。
- `question_reviews`：reviewer、decision、notes、版本。
- `rubric_items`：若需要查询/统计则分表；否则先放 canonical JSON，但必须 Schema 校验。

过渡：现有 `questions.stem/options/answer_key/...` 保持；新版本写入后由 adapter 投影旧字段。不要直接删除旧列。

### 4.4 课程、考点和分类

- `courses`。
- `knowledge_tree_versions`。
- `knowledge_nodes`：parent、code、name、aliases、merge status。
- `question_classifications`：question version、knowledge node、权重、认知层次、置信度、ai run、teacher override。
- `difficulty_assessments`：kind=`predicted|teacher|observed`、level/value/rationale/sample size/version。

### 4.5 模板、细目表和生成

- `paper_template_versions`、`paper_template_sections`、`paper_template_slots`。
- `blueprints`：kind=`historical|target|actual`、version、status、source/target paper references。
- `blueprint_cells`。
- `generation_batches`：N、目标表、模板、状态。
- `generation_slots`：每套每题位的约束和状态。
- `generation_candidates`：slot、question version、验证/选择状态。
- `quality_reports`、`quality_issues`。
- `similarity_results`、`equivalence_results`。

### 4.6 标准试卷和导出

- 现有 `papers` 保留并扩展 `canonical_version_id`/`generation_batch_id`（可为空）。
- `paper_versions`：canonical paper JSON、version、actual blueprint、quality status、frozen at。
- `paper_version_items`：section/slot/question version/score/order。
- `export_artifacts`：paper version、format、renderer version、hash、compile/open status、error。

### 4.7 约束和索引

- source document hash + project 防重复上传。
- step run attempt 唯一；active lease 索引。
- question version `(question_id, version)` 唯一。
- source locator 不允许同一原题重复导入（需允许教师明确 override）。
- knowledge node code 在 tree version 内唯一。
- blueprint cell 维度组合唯一。
- generation slot `(batch_id,set_no,slot_key)` 唯一。
- paper version item order 唯一。
- export `(paper_version_id,format,renderer_version)` 唯一。

## 5. API 修改计划

现有 API 保持兼容；新增 `/api/projects/:id/pipeline...` 与相关资源路由。

### 5.1 管道

- `POST /api/projects/:id/pipeline-runs`：启动，返回 run。
- `GET /api/projects/:id/pipeline-runs/:runId`：步骤、进度、产物、错误。
- `POST /api/projects/:id/pipeline-runs/:runId/steps/:stepKey/retry`：重跑失败/过期 step。
- `POST /api/projects/:id/pipeline-runs/:runId/steps/:stepKey/cancel`：可选。
- 兼容 `POST /api/projects/:id/start`：内部转调新启动 API，过渡期保留。

所有写接口用 Zod；重跑要求 idempotency key 或明确 attempt。

### 5.2 提取、切题和对齐

- `GET /api/projects/:id/documents`。
- `GET /api/documents/:id/pages/:pageNo`。
- `PATCH /api/content-blocks/:id`：教师纠错。
- `GET /api/projects/:id/question-drafts`。
- `PATCH /api/question-drafts/:id`。
- `GET /api/projects/:id/answer-alignments`。
- `PATCH /api/answer-alignments/:id`：选定答案/解除/合并。
- `POST /api/projects/:id/answer-alignments/confirm`。

### 5.3 考点体系和分类

- `GET/POST /api/courses/:courseId/knowledge-trees`。
- `PATCH /api/knowledge-nodes/:id`。
- `POST /api/knowledge-nodes/:id/move`。
- `POST /api/knowledge-nodes/:id/merge`。
- `PATCH /api/question-versions/:id/classifications`。

### 5.4 模板和细目表

- `GET /api/projects/:id/historical-analysis`。
- `GET/PATCH /api/projects/:id/templates/:versionId`。
- `POST /api/projects/:id/templates/:versionId/confirm`。
- `GET/PATCH /api/projects/:id/blueprints/:kind/:versionId`。
- `POST /api/projects/:id/blueprints/target/:versionId/confirm`。
- `GET /api/projects/:id/generation-plans/:id`。
- `PATCH/confirm` 对应计划。

批准请求必须携带 `version` 或 ETag，防止批准已被修改的旧对象。

### 5.5 生成、质量和选卷

- `POST /api/projects/:id/generation-batches`：指定 template/target blueprint/N。
- `GET /api/generation-batches/:id`。
- `POST /api/generation-slots/:id/retry`。
- `GET /api/generation-batches/:id/papers`。
- `GET /api/paper-versions/:id/quality-report`。
- `GET /api/generation-batches/:id/comparison`：N套等价、相似、target vs actual。
- `PATCH /api/question-versions/:id`：教师修改形成新版本，并使相关验证 stale。
- `POST /api/paper-versions/:id/approve`。

### 5.6 导出

- `POST /api/paper-versions/:id/exports`，body `{formats:['latex','docx','md']}`。
- `GET /api/paper-versions/:id/exports`。
- `GET /api/export-artifacts/:id/download`。

响应必须区分 `generated`、`verified`、`failed`；LaTeX 未编译、DOCX 未通过 reopen 时不能返回“已验证”。

## 6. 前端页面修改计划

### 6.1 现有页面

- `ProjectNew.tsx`：修复上传后启动；文案和实际动作一致；显示数据外发/OCR provider 提示。
- `ProjectWorkspace.tsx`：由硬编码 7 steps 改为读取 `step_runs`；显示 attempt、错误详情、重跑、产物版本；禁止空产物批准。
- `QuestionBank.tsx`：增加 origin、版本、来源页、预测/教师/实测难度、AI/教师修订筛选。
- `QuestionEdit.tsx`：从 JSON TextArea 逐步升级为题型化答案/rubric/子题/content block 编辑；保留原始 JSON 高级模式。
- `PaperEdit.tsx`：读取 question version；显示 target/actual cell 和质量 issue；修改题目时触发快照/验证失效提示。

### 6.2 新页面/组件

- `DocumentReview.tsx`：页图与提取块并排、OCR 置信度和问题列表。
- `QuestionAlignment.tsx`：题目与答案匹配、原题号、置信度、人工确认。
- `KnowledgeTreeEditor.tsx`：考点树新增/移动/合并/别名。
- `HistoricalAnalysis.tsx`：跨年趋势和历史细目表。
- `TemplateEditor.tsx`：section/slot、数量/分值/时长实时校验。
- `TargetBlueprintEditor.tsx`：矩阵编辑、容差、必考/禁考。
- `GenerationPlanReview.tsx`：逐题位约束。
- `PaperComparison.tsx`：N套 target vs actual、等价性、相似度、质量 issue。
- `ExportCenter.tsx`：同一 paper version 的三格式生成和验收状态。

首期可以把这些作为 `ProjectWorkspace` 内的 tab/route，避免整体导航重构。

## 7. 测试计划

### 7.1 单元测试

- 所有 Zod Schema：正确/缺字段/错误枚举/非法 option answer/rubric 不合计/递归子题。
- PDF 页质量判定、OCR 触发、DOCX fallback 实际读取。
- 题目/答案切分：缺题号、跨页、答案独立文件、组合题、嵌套 enumerate。
- 对齐：一对一、一对多、无答案、重复题号、低置信度。
- 目标细目表和模板求解，分值/题数/容差不可满足。
- exact/near duplicate、数字归一化、公式骨架比较。
- actual blueprint 反算。
- 三 renderer 对相同 canonical fixture 的题数/分值/答案/rubric manifest 一致。

### 7.2 AI contract 测试

- 为 AI client 注入 fake provider，不调用真实网络。
- 保存真实 provider 的脱敏响应 fixture，测试 Schema parse。
- 模拟 malformed JSON、截断、空响应、429、500、超时、Schema repair 成功/失败。
- 验证 prompt key/version/hash 和模型参数被记录。
- 模拟 vision 请求，断言实际包含图像 content，而非文件名占位符。

### 7.3 集成测试

- 上传 TEX → 切题 → 对齐 → canonical question → taxonomy → template/target → 生成 batch → quality → actual → export。
- 上传扫描 PDF fixture → OCR；无 OCR provider 时明确 failed/needs_review。
- UI常见链：创建+上传后确实启动或可启动。
- 任一步 0 产物不得进入下一步。
- 单文件/单套失败形成 `partial_failed`，只重跑失败项。
- 进程中断/重启后 lease 回收与断点继续。
- 重复点击 start/retry 不生成重复 records。
- 编辑考点/模板/目标表后旧批准和下游结果变 stale。

### 7.4 导出验收

- LaTeX：在 CI 安装固定引擎，必须实际编译；解析 log，失败为测试失败。
- DOCX：检查 ZIP/OOXML，使用解析器重新打开并核对题数/文本/表格/图片。
- Markdown：解析 AST，检查数学 fence、图片链接、题号和答案。
- 三格式：比较同一 manifest，而不是让 AI 泛化判断。

### 7.5 浏览器 E2E

- 教师上传、处理提取问题、对齐答案、编辑考点、编辑目标表、启动 N 套生成、处理失败、比较和导出。
- 验证空蓝图不可批准、失败不能显示完成、无输出不能选卷。
- 题目编辑和版本/来源显示。

### 7.6 回归命令

每阶段至少执行：

```text
npm test
npm run build
npm run lint
```

并新增独立 `test:pipeline`、`test:export`、`test:e2e` 脚本；真实 AI 测试默认不进常规 CI，使用显式环境和脱敏数据。

## 8. 分阶段实施顺序

### Phase 0：基线和数据保护（1 个短迭代）

- 固化当前 API/DB fixture 和回归测试。
- 增加正式数据库备份/恢复说明。
- 给旧项目/文件/题目标记 legacy 来源。
- 明确外部 AI/OCR 数据外发规则。

退出标准：当前 12 个测试继续通过；可恢复数据库；新测试能稳定复现 RC-01/RC-02。

### Phase 1：P0 控制流、状态和日志

- 修上传后启动、空产物 done、0/0 success、error retry。
- 引入 `pipeline_runs/step_runs` 最小版和持久事件详情。
- 当前 0-6 步先包进 step handler，不重写认知逻辑。

退出标准：AI/工具全失败时项目为 failed/partial_failed；前端可只重跑失败步；重启可恢复。

### Phase 2：文档提取、历史切题、答案对齐、规范化

- 真正 PDF/DOCX/OCR adapter。
- 历史题和答案成为 canonical versions，页码/原题号可追溯。
- 教师对齐页面上线。

退出标准：选定课程样本中每道历史题/答案有稳定 ID 和来源；低置信项不自动通过。

### Phase 3：考点体系、历史分析、模板和三类细目表

- 考点树和教师治理。
- historical blueprint、模板版本、target editor。
- generation plan slot 化。

退出标准：教师可从历史分析编辑并冻结目标表/模板；约束不自洽时禁止生成。

### Phase 4：结构化生成、答案/rubric和质量闭环

- 逐 slot 生成、答案/rubric独立阶段、验证 gate。
- actual blueprint、重复度、N套等价性。

退出标准：每道生成题可追到 slot/目标/材料/AI run；每套 actual 与 target 差异可见；不通过 gate 不可选卷。

### Phase 5：统一导出和教师选卷

- CanonicalPaper renderer。
- LaTeX编译、DOCX reopen、Markdown AST 和三格式 manifest。
- N 套比较/选卷/冻结。

退出标准：三种格式来自同一 paper version，内容 manifest 一致；所需格式验证通过后才 completed。

### Phase 6：迁移和清理

- 为旧项目/题目按需生成 canonical version 或保持只读 legacy。
- 观察期后移除未使用 `claude.ts`、`workflow.ts` 旧生成函数等死路径。
- 删除旧字段必须另立 migration 和兼容公告，不在前述阶段直接删除。

## 9. 预计破坏兼容性的修改

| 修改 | 潜在破坏 | 兼容策略 |
|---|---|---|
| 项目状态语义变化 | 前端依赖 `drafting/.../done` | 过渡期继续回写旧 status；新 API 返回详细 pipeline status |
| `/start` 幂等和异步 run ID | 调用方只期待 message | 保留旧响应字段并新增 `runId` |
| checkpoint 绑定 version | 旧请求没有 version | 旧项目可省略；新对象要求 ETag/version，逐页升级前端 |
| Question 增加 version/origin/typed answer | 旧前端和考试快照读取旧字段 | adapter 投影 `stem/options/answerKey`；考试发布仍冻结旧兼容快照 |
| `difficulty` 改为三类 | 旧筛选只识别单字段 | `difficulty` 暂映射 teacher 优先、否则 predicted；API 增加明确字段 |
| source_file 含义变化 | 旧生成题指向 generated TEX | 保留旧 sourceFileId；新 `question_sources` 表提供真正题源和 generation trace |
| 输出 API 返回验证状态 | 旧 UI 把存在文件当成功 | 保留下载；UI逐步使用 `verificationStatus`，完成条件改为 verified |
| 旧 LaTeX importer 不再主路径 | 依赖自由格式生成的脚本 | 保留显式 legacy import 命令和 issue report，不静默运行 |
| Markdown/Docx renderer 改写 | 版式可能变化 | renderer version 化，旧 artifact 可下载，新 artifact 可比较 |
| SQLite schema显著扩展 | 数据文件变大、迁移耗时 | migration 前自动备份；小批迁移；旧列不删 |

任何删除旧字段、旧路由或旧导出格式的动作都应独立发布并提供数据迁移/回滚，不与核心修复同批进行。

## 10. 需要教师确认的业务规则

以下规则无法仅凭代码推断，实施前必须由课程教师/教务负责人确认：

1. 真题和答案文件如何识别：同卷、独立答案、混合文件、不同年份命名约定。
2. “原题号”是否允许重复（不同卷/大题/子题），稳定编号展示格式。
3. 组合题父题与子题如何计分；rubric 是按子题还是按总题。
4. 考点树层级和粒度；一题多考点时分值如何分摊。
5. “必考考点”的定义：频次、年份连续性、教师指定还是大纲要求。
6. 历史细目表的统计单位：题、子题、分值还是主考点权重。
7. 目标细目表的维度和容差：考点×题型、考点×难度、认知层次是否都要硬约束。
8. 模板是选择某一年、取多年众数，还是允许多个模板族。
9. 总分/时长/大题结构冲突时，逐题分值与标题声明哪个优先；是否必须人工确认。
10. 预测难度分级标准和证据；教师能否覆盖模型难度，覆盖是否需要理由。
11. 实测难度的公式：得分率、通过率、区分度、样本量门槛和异常作答处理。
12. N 套“等价”的允许偏差：考点、难度、题型、阅读量、计算量各自阈值。
13. 近似题/抄题阈值；仅换数字是否视为新题；哪些经典定义题可例外。
14. 参考答案独立验证的责任边界：AI、符号工具、第二模型、教师最终签字分别承担什么。
15. 主观题评分项是否允许替代解法、过程分、连带错误和上限规则。
16. 客观题答案表示：选项 ID/字母、选项随机化、多个等价填空、数值容差和单位。
17. 是否允许超纲拓展题；若允许，比例和标识方式。
18. 教师修改生成题后，答案/rubric/难度/actual blueprint 哪些必须自动失效重算。
19. 选卷后是否允许继续编辑；发布考试后继续沿用当前不可变快照规则。
20. 导出范围：学生卷、答案卷、评分细则是否分文件；三格式是否全部必交。
21. DOCX/LaTeX 的学校模板、字体、页眉页脚、密封线、题号和图片分辨率要求。
22. 外部 AI/OCR provider 是否允许接收真题，是否需要脱敏、数据保留期限和授权提示。
23. Prompt/模型输出、教师修改和原始文件的保留期限、访问角色与审计要求。
24. 无真实学生数据时页面和导出统一使用“预测难度”的具体措辞。

## 11. 每阶段验收报告模板

每个实施阶段结束时应报告：

- 修改文件列表。
- 新增/变更接口。
- migration 与数据回填结果。
- 自动测试命令和真实结果。
- 使用的 fixture、实际生成/导出产物及验证状态。
- 兼容性影响和回滚方式。
- 未解决问题与“需要确认”项。

不得以“代码路径存在”代替“实际运行可用”；任何未安装工具、未获外部数据发送授权、未执行真实编译/打开的能力都必须标记“需要确认”。
# 2026-08-04 结构化链路接入状态

本节记录实际实现与测试状态；未执行的真实模型或 LaTeX 编译不会标记为通过。

| 子阶段 | 状态 | 验证 |
|---|---|---|
| PromptVersion / AiRun 留痕与有限修复重试 | 已完成 | `promptRunnerPersistence.test.ts` |
| 结构化答案候选与答案对齐 | 已完成 | `answerAlignmentService.test.ts`、`answerAlignmentMigration.test.ts` |
| 文档语义分块与 token budget | 已完成 | `documentChunking.test.ts` |
| 统一导出与 audience 后端隔离 | 已完成 | `exportArtifacts.test.ts`、`exportAuthorizationApi.test.ts` |
| 单套试卷脱敏 fixture E2E | 已完成 | `questionGenerationPipelineE2E.test.ts` |
| 真实模型 smoke | 需要环境确认 | 默认跳过；设置 `RUN_LIVE_AI_TESTS=1` 及 AI key 后执行 |
| LaTeX PDF 编译 | 运行时检测 | 仅在检测到 `xelatex` 时执行并断言 PDF；缺失时明确记为未编译 |

可重复执行命令：

```powershell
npm run question-generation:e2e -w @exam-maker/server
$env:RUN_LIVE_AI_TESTS='1'; npm test -w @exam-maker/server -- liveStructuredPrompt.smoke.test.ts
```

E2E 的生成阶段使用显式标注的 `deterministic-fixture`，用于验证结构、持久化、权限与导出，不代表真实模型成功率。真实首次 Schema 通过率和修复后通过率只有运行 live smoke 后才能报告。
