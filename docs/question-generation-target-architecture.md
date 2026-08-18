# 题目生成目标架构

> 目标：在不更换 React/Express/TypeScript/Drizzle/SQLite 技术栈、不删除当前题库和考试功能的前提下，把现有“文件→自由 LaTeX”原型演进为可追溯、可编辑、可恢复、可验证的分阶段命题系统。

## 1. 设计原则

1. **结构化数据优先。** Markdown、LaTeX、DOCX 都是渲染产物，不再承担核心业务数据职责。
2. **分阶段、可持久化。** 每一步有明确 Schema、输入版本、输出版本、状态、日志和重跑入口。
3. **AI 只负责受约束的认知任务。** 文件保存、分值求和、选项一致性、rubric 合计、状态机、导出等必须由确定性代码完成。
4. **人机共管。** 考点体系、题目/答案对齐、模板、目标细目表和最终选卷都可由教师编辑并形成版本。
5. **来源可追溯。** 真题的每道题定位到原文件、页码/区域/原题号；生成题定位到计划 slot、目标细目表、参考材料和 AI run。
6. **先校验再推进。** Schema、硬规则或质量 gate 不通过时不得进入下一步，也不得标记 `done`。
7. **统一试卷对象，多渲染器。** Markdown、LaTeX、DOCX 必须从同一份冻结的 `CanonicalPaper` 生成，禁止分别调用 AI。
8. **难度语义明确。** 没有学生统计时只能写“预测难度”；教师判断和实测难度分别保存。

## 2. 总体模块图

```text
文件上传
  ↓
文档导入与资产登记
  ↓
逐页提取/OCR ──→ 提取质量检查 ──→ 教师纠错
  ↓
文档结构识别
  ↓
真题切分 ──→ 答案切分 ──→ 题目-答案对齐确认
  ↓
题目规范化与版本化（CanonicalQuestion）
  ↓
课程考点树生成/合并/教师编辑
  ↓
真题考点分类 + 预测难度 + 认知层次
  ↓
历史命题分析 + 历史细目表
  ↓
结构模板提取/教师编辑
  ↓
目标细目表编辑
  ↓
命题计划（每个题位的完整约束）
  ↓
逐题生成 → 答案生成 → rubric生成 → 独立验证
  ↓
组装 N 套 CanonicalPaper
  ↓
实际细目表反算 + 目标差异 + 重复/近似/等价性检查
  ↓
教师比较、修订、冻结
  ↓
LaTeX / DOCX / Markdown 确定性渲染与验收
```

## 3. 标准业务对象

以下示意类型应在 `shared/` 用 Zod 定义，并由 `z.infer` 生成 TypeScript 类型。字段可分表保存，但阶段交接必须符合这些 Schema。

### 3.1 内容块

```ts
type ContentBlock =
  | { type: 'paragraph'; markdown: string }
  | { type: 'math'; latex: string; display: boolean }
  | { type: 'table'; columns: string[]; rows: string[][]; caption?: string }
  | { type: 'image'; assetId: number; alt: string; caption?: string }
  | { type: 'code'; language?: string; code: string }
  | { type: 'page_break' };
```

这允许不同课程保留公式、表格、图片和代码，不再把所有内容压成一个字符串。原始 Markdown/LaTeX 可以继续保留为兼容字段或渲染缓存。

### 3.2 题源定位

```ts
interface SourceLocator {
  sourceDocumentId: number;
  pageStart: number | null;
  pageEnd: number | null;
  boundingBoxes?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  originalQuestionNo: string | null;
  extractionRunId: number;
  excerptHash: string;
}
```

### 3.3 标准题目

```ts
interface CanonicalQuestion {
  id: number;
  version: number;
  origin: 'historical' | 'ai_generated' | 'teacher_authored' | 'teacher_modified';
  type:
    | 'single_choice' | 'multiple_choice' | 'true_false' | 'fill_blank'
    | 'short_answer' | 'calculation' | 'proof' | 'essay' | 'composite';
  parentQuestionId: number | null;
  orderInParent: number | null;
  stem: ContentBlock[];
  options: Array<{ id: string; content: ContentBlock[] }> | null;
  answer: AnswerSpec | null;
  solution: ContentBlock[];
  rubric: RubricItem[];
  defaultScore: number;
  knowledgePointIds: number[];
  cognitiveLevel: string | null;
  predictedDifficulty: DifficultyAssessment | null;
  teacherDifficulty: DifficultyAssessment | null;
  observedDifficulty: ObservedDifficulty | null;
  sourceLocator: SourceLocator | null;
  generationTrace: GenerationTrace | null;
  reviewStatus: 'draft' | 'needs_review' | 'approved' | 'rejected';
}
```

建议答案为 discriminated union：

```ts
type AnswerSpec =
  | { kind: 'single_choice'; optionId: string }
  | { kind: 'multiple_choice'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; accepted: string[]; caseSensitive?: boolean }
  | { kind: 'numeric'; value: string; tolerance?: string; unit?: string }
  | { kind: 'expression'; latex: string; equivalentForms?: string[] }
  | { kind: 'subjective'; keyPoints: string[] };

interface RubricItem {
  id: string;
  description: string;
  points: number;
  requiredEvidence?: string;
  dependencies?: string[];
}
```

硬性校验：选择题答案必须引用现有 option id；rubric 合计必须等于题目分值；父题与子题分值规则必须由课程模板明确。

### 3.4 难度

```ts
interface DifficultyAssessment {
  level: 'basic' | 'medium' | 'hard';
  score?: number;             // 可选连续值，例如 0..1
  rationale: string;
  assessedBy: 'model' | 'teacher';
  assessedAt: string;
  modelRunId?: number;
}

interface ObservedDifficulty {
  pValue: number;             // 得分率/通过率定义由业务规则确认
  sampleSize: number;
  calculationVersion: string;
  calculatedAt: string;
}
```

页面和导出必须显示“预测难度/教师难度/实测难度”，不再统称“难度”。

### 3.5 考点体系

```ts
interface KnowledgeNode {
  id: number;
  courseId: number;
  parentId: number | null;
  code: string;
  name: string;
  description: string | null;
  aliases: string[];
  status: 'active' | 'merged' | 'archived';
  mergedIntoId: number | null;
  version: number;
}
```

AI 可以从新课程真题/大纲提出初始树，但教师必须能新增、改名、移动、合并和归档。题目分类引用稳定 ID，不引用易变化的自由文本名称。

### 3.6 三类细目表

统一用版本化 `Blueprint` + `BlueprintCell`：

- `historical`：由已审核真题统计得到，按年份/试卷可追溯。
- `target`：教师为本次命题编辑的约束。
- `actual`：生成后从 `CanonicalPaper` 反算，不由 AI 自报。

每个 cell 至少含：`knowledgePointId`、`questionType`、`cognitiveLevel`、`predictedDifficulty`、`questionCount`、`score`、`percentage`。目标表另含容差和必选/禁选规则。

### 3.7 结构模板和命题计划

```ts
interface PaperTemplate {
  id: number;
  version: number;
  courseId: number;
  totalScore: number;
  durationMinutes: number;
  sections: Array<{
    id: string;
    title: string;
    type: string;
    questionCount: number;
    score: number;
    slots: Array<{ id: string; score: number; allowsSubquestions: boolean }>;
  }>;
}

interface GenerationSlot {
  id: string;
  sectionId: string;
  score: number;
  questionType: string;
  knowledgePointIds: number[];
  cognitiveLevel: string;
  predictedDifficulty: 'basic'|'medium'|'hard';
  requiredMaterials: number[];
  forbiddenSourceQuestionIds: number[];
  noveltyConstraints: string[];
  answerVerificationMode: string;
}
```

命题计划由目标细目表和模板确定性求解；AI 只生成各 slot 的内容，不能自行改变题量、分值或考点配比。

### 3.8 统一试卷对象

```ts
interface CanonicalPaper {
  id: number;
  version: number;
  generationBatchId: number;
  setNo: number;
  title: string;
  courseId: number;
  instructions: ContentBlock[];
  durationMinutes: number;
  totalScore: number;
  sections: Array<{
    id: string;
    title: string;
    questions: Array<{
      questionVersionId: number;
      slotId: string;
      score: number;
    }>;
  }>;
  answerSheet?: unknown;
  actualBlueprintId: number;
  qualityStatus: 'pending'|'failed'|'passed'|'teacher_approved';
}
```

LaTeX、DOCX、Markdown 渲染器只能读取冻结版本的该对象。格式转换不允许改题目内容、答案或评分标准。

## 4. 持久化流水线

### 4.1 通用阶段记录

建议新增：

```ts
PipelineRun {
  id, projectId, pipelineVersion, status,
  requestedBy, createdAt, startedAt, finishedAt
}

StepRun {
  id, pipelineRunId, stepKey, attemptNo,
  status: queued|running|needs_review|succeeded|failed|cancelled,
  inputRefType, inputRefId, inputVersion,
  outputRefType, outputRefId, outputVersion,
  progressCurrent, progressTotal,
  errorCode, errorMessage, errorStack,
  retryable, startedAt, heartbeatAt, finishedAt
}
```

每步以 `(pipelineRunId, stepKey, inputVersion, attemptNo)` 标识。输出写入成功并通过 Schema/硬规则后，才在同一事务内将 step 标记 `succeeded`。

### 4.2 建议阶段及输入/输出

| stepKey | 输入 | 结构化输出 | 人工检查 |
|---|---|---|---|
| `document_import` | 上传文件 | SourceDocument + Asset | 文件列表 |
| `content_extract` | SourceDocument | PageContent[] + ExtractionIssue[] | 低置信页 |
| `structure_detect` | PageContent[] | DocumentStructure | 可选 |
| `question_segment` | DocumentStructure | HistoricalQuestionDraft[] | 必要时 |
| `answer_segment` | 答案文档结构 | AnswerDraft[] | 必要时 |
| `answer_align` | 两类 draft | AlignmentCandidate[] | 低置信项必须确认 |
| `question_normalize` | 已对齐 draft | CanonicalQuestionVersion[] | 抽检/批量审核 |
| `taxonomy_build` | 课程材料+题目 | KnowledgeTreeVersion | 必须可编辑确认 |
| `classify` | 题目+考点树 | QuestionClassification[] | 低置信项 |
| `historical_analyze` | 已审核真题 | HistoricalAnalysis + historical blueprint | 查看 |
| `template_extract` | 历史试卷 | PaperTemplateVersion[] | 必须编辑/确认 |
| `target_blueprint` | 历史分析+模板 | TargetBlueprintVersion | 必须编辑/确认 |
| `generation_plan` | target + template | GenerationPlan | 必须确认 |
| `question_generate` | 单个 slot | QuestionDraft[] | 自动 gate 后抽检 |
| `answer_generate` | question draft | AnswerSpec + Solution | 自动 |
| `rubric_generate` | question + answer | RubricItem[] | 自动 |
| `answer_verify` | 题/答案/rubric | VerificationResult | 失败阻断 |
| `paper_assemble` | 通过的 slot result | CanonicalPaper[] | 自动 |
| `quality_check` | N 套 paper | QualityReport[] | 失败阻断/教师处理 |
| `actual_blueprint` | paper | actual blueprint + target diff | 必须展示 |
| `teacher_review` | paper + reports | 冻结 paper version | 必须 |
| `export` | 冻结 paper | ExportArtifact[] | 格式验收 |

### 4.3 重试和断点

继续使用 Express/SQLite，不必立即引入 Redis/Celery：

- 用数据库 `step_runs` 作为持久队列；后台 runner 原子领取 `queued` step 并写 lease/heartbeat。
- 每个 step handler 必须幂等：输出按 input version + handler version 做唯一约束；重复执行生成新 attempt，不覆盖旧证据。
- AI 网络错误、429、5xx、超时可按配置指数退避；Schema 错误先进入一次 `repair` prompt，仍失败则 `needs_review/failed`。
- 进程重启后回收 heartbeat 超时的 `running` step。
- 教师可从某一步“重新执行”，下游旧版本标记 stale，而不是删除。
- 单份文件或单套卷失败不丢其他结果；batch 状态为 `partial_failed`，允许只重跑失败项。

SQLite 在单机教学场景可继续使用；需用短事务、唯一索引和 lease 避免重复执行。并发量超过单机能力时再评估数据库升级，当前修复不要求换框架。

## 5. AI 调用治理

### 5.1 Prompt 注册

建议建立 `server/src/prompts/`：每个任务导出：

```ts
{
  key: 'question-segment';
  version: '1.0.0';
  modelPolicy: 'structured-low-temperature';
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  buildMessages(input): AiMessage[];
}
```

每次调用记录：prompt key/version/hash、provider、model、base URL 标识、temperature、max tokens、开始/结束时间、request/response ID、usage、输入/输出 artifact 引用、错误和修复次数。密钥和完整敏感内容不写日志；原始 payload 按权限/保留策略保存。

### 5.2 结构化输出

- OpenAI-compatible provider 优先使用 `response_format/json_schema`（若 provider 支持）；不支持时仍以 JSON 输出并用 Zod 校验。
- Anthropic 可用 tool schema/结构化 tool result。
- 校验失败不能补空字段后继续；必须形成明确的 validation error。
- 自由 LaTeX 仅允许出现在 `ContentBlock.math.latex` 或最终渲染器，不作为整步 AI 输出载体。

### 5.3 分任务生成

生成一题建议分为：

1. `question_generate`：只出题面、选项、考点/认知层次自报。
2. 确定性规则校验题型和选项。
3. `answer_generate`：基于已冻结题面独立生成答案和解法。
4. `rubric_generate`：基于题面/答案/分值生成逐项评分。
5. `answer_verify`：不同 prompt；条件允许时使用不同模型或符号/数值工具独立验证。
6. 任一阶段修改题面后，答案/rubric/验证全部失效并重跑。

## 6. 提取与 OCR 架构

### 6.1 适配器

保留 `paperParser` 的调度思想，但改成：

```ts
interface DocumentExtractor {
  supports(document: SourceDocument): boolean;
  extract(document): Promise<PageContent[]>;
}
```

- PDF 文本：按页提取，保存 page number 和 text blocks。
- DOCX：Pandoc 可继续作为首选；应增加真正读取内容的 fallback，而不是文件名占位符。
- 扫描 PDF/图片：PDF逐页渲染为图片，再调用本地 OCR 或明确配置的多模态/OCR provider；请求必须实际携带图像。
- 数学、表格和图形：保留页面截图/区域资产，OCR 结果和原图并存，允许教师纠错。

### 6.2 OCR 触发条件

不能只看整份文本是否少于 50 字。建议按页计算：字符密度、可选文字比例、乱码率、图片覆盖率和 OCR 置信度。只有低质量页进入 OCR；混合 PDF 可逐页选择文本提取或 OCR。

### 6.3 验证

- 二进制文件绝不能因为“无法比对”自动 `verified=true`。
- 标记 `extraction_status=needs_review`，并展示原页与提取块并排。
- 页码、题号、公式、表格、图像引用和分值必须有确定性检查报告。

## 7. 质量门禁

### 7.1 单题硬规则

- Schema 有效；题干非空。
- 选择题选项数、唯一性和答案引用有效；单选只能一个答案。
- 子题顺序和分值有效。
- rubric 合计 = 题目分值。
- 答案存在；客观题答案可机器判定。
- 来源/生成 trace 完整。
- 预测难度标签带 rationale 和 model run。
- 与历史题、同批其他题 exact hash 不重复；近似度超过阈值进入人工复核或拒绝。

### 7.2 单卷硬规则

- section 数量、题型、题数和分值符合模板。
- 总分由 question score 求和，且等于模板总分。
- actual blueprint 从题目反算；每个 target cell 在容差内。
- 所有题答案和 rubric 已验证。
- 没有禁用/未审核考点、超纲材料或缺失资产。

### 7.3 N 套等价性

逐套比较：总分、题型结构、考点覆盖、认知层次、预测难度分布、计算量/阅读量（先用可解释 proxy）、素材复用率。输出 pairwise matrix 和超差项；不能只让 AI一句话判断“等价”。

### 7.4 重复度

第一阶段可在当前技术栈内实现：

- Unicode/空白/LaTeX 规范化后的 exact hash。
- token n-gram Jaccard/SimHash。
- 数学表达式数字归一化后比较题型骨架。
- 选择题选项集合归一化。

语义 embedding 可作为后续增强，但不能替代可解释规则。新题和所有历史真题都要比较，而不只是同批 N 套。

## 8. 教师工作台

继续使用 React + Ant Design，新增或拆分页面：

- 导入检查：文件、页预览、OCR/提取问题。
- 题目对齐：左侧题目、右侧答案、置信度、拖拽/选择对齐。
- 考点树编辑：新增、移动、合并、别名、归档。
- 历史分析：按年份/题型/考点/难度筛选。
- 模板编辑：section/slot 可编辑，总分实时校验。
- 目标细目表：表格编辑、锁定必考点、容差提示。
- 命题计划：每 slot 的考点、难度、分值、生成状态。
- N 套比较：target vs actual、等价性、重复度、质量问题并排。
- 题目审核：题面/答案/rubric/来源/AI trace 一屏显示，教师修改形成新版本。
- 导出中心：同一 paper version 的三格式状态、hash、编译/打开检查。

批准动作必须绑定具体对象版本；对象编辑后旧批准自动失效。

## 9. 统一导出

建议新增纯函数 renderer：

```text
CanonicalPaper(version=N)
  ├─ renderMarkdown() → .md
  ├─ renderLatex()    → .tex → XeLaTeX/tectonic → .pdf
  └─ renderDocx()     → .docx（直接构建或由规范 Markdown/HTML 转换）
```

要求：

- 三者读取同一冻结 JSON，不调用 AI。
- 每个 artifact 记录 paper version、renderer version、源对象 hash、文件 hash。
- 生成后解析/检查题号、题目数、分值、答案数和 rubric 数；三格式生成 manifest 比较。
- LaTeX 必须实际编译成功才标 `verified`；否则只标 `source_generated`。
- DOCX 至少检查 ZIP/OOXML 完整性并实际重新打开解析；浏览器/Word 视觉验收可列为教师确认。
- Markdown 检查资源链接和数学块闭合。

## 10. 状态语义

项目顶层状态由 step runs 聚合，不由业务函数随意写字符串：

- `draft`：尚未启动。
- `running`：存在运行步骤。
- `needs_review`：等待教师处理具体版本。
- `partial_failed`：部分子任务失败，可重跑。
- `failed`：关键步骤失败且无有效产物。
- `ready_for_selection`：N 套卷通过自动 gate，可供教师比较。
- `completed`：教师已选择/冻结并且所需导出通过。

严禁 0 套生成、0/0 编译、目标细目表不达标或所需格式未生成时进入 completed。

## 11. 兼容现有功能

- 保留现有 `/api/questions`、`/api/papers`、`/api/exams`、`/api/attempts`。
- 新的 canonical question 通过适配层继续映射到现有考试快照，逐步扩展字段。
- 已有自由文本 `stem/analysis` 继续可读；新版本同时写结构化 content，迁移完成前保持双读。
- 现有项目文件仍可下载；新的 artifact 表逐步接管版本和验证元数据。
- 现有 `project.status` 在过渡期由新 pipeline 聚合回写，避免立即破坏前端。
- 先修控制流/状态门禁，再引入新实体，不做一次性全仓重写。
