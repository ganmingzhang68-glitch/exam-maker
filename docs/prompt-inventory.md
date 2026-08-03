# AI Prompt 清单

审查日期：2026-08-04
审查范围：`server/src` 中所有 `sendMessage()` 调用、Prompt 构造函数及 AI 客户端。
结论口径：第 1–5 节记录替换前基线，用于保留审计证据；第 6 节记录本轮替换后的实际状态。

## 1. AI 调用基础设施

| 项目 | 当前实现 |
|---|---|
| 主调用入口 | `server/src/services/ai.ts:sendMessage(systemPrompt, messages, options)` |
| Anthropic | `sendAnthropic()`；system prompt 进入 `messages.create({system})` |
| OpenAI compatible | `sendOpenAI()`；system prompt 作为首条 `role=system` 消息 |
| 旧客户端 | `server/src/services/claude.ts:sendMessage()`；仓库内没有 import，属于未使用代码 |
| 结构化输出 | 不存在 tool schema、JSON schema response format 或 Zod 解析 |
| Prompt 版本 | 不存在 |
| 模型/Prompt 审计记录 | 调用处不记录 Prompt hash、版本、参数、response id 或 usage |

## 2. Prompt 总表

“Schema”列描述当前代码实际接受的返回，而不是 Prompt 文案声称的格式。

| ID | Prompt 与调用位置 | 输入变量 | 当前期待输出 | 输出示例 | 硬编码 | 多职责 |
|---|---|---|---|---|---|---|
| P-01 | 转写核对：`paperParser.ts:verifyParsed()`，Prompt 约在 108 行，调用约在 126 行 | `result.format`、`origContent[0:3000]`、`texContent[0:5000]` | 自由文本；通过 `includes('VERDICT: PASS')` 判断 | 无 JSON 示例；只有终止标记示例 | 固定核对项、LaTeX | 是：内容完整性、公式、分值、表格、图片同时判断并提出修复 |
| P-02 | 文件转写：`paperParser.ts:convertToLatex()`，Prompt 约在 333 行，调用约在 350 行 | `filename`、`sourceType`、`rawContent[0:12000]` | 任意 LaTeX 字符串，无 Schema | 有格式要求，无完整正确/异常输出示例 | 强制 LaTeX、`\\score{n}`、tabular/booktabs | 是：文档识别、结构提取、公式转写、表格转写、图片描述混合 |
| P-03 | 真题分析：`blueprint.ts:buildAnalyzePrompt()`，调用 `analyzeQuestions()` 约在 167–169 行 | `texContent[0:10000]`、`src`、`course`、`scope` | JSONL；`parseJsonl()` 只检查字段存在，不做类型/枚举 Schema 校验 | 有 2 行正常示例；无异常示例 | 中文题型、中文难度、中文认知层级；默认每题 1–2 考点 | 是：切题、分值估算、考点分类、难度、认知层级、题干范式一起完成 |
| P-04 | 考点分析核对：`blueprint.ts:verifyBlueprint()`，Prompt 约在 336 行，调用约在 354 行 | `course`、前 30 题摘要、整份 `kpList` | 自由文本；`includes('VERDICT: PASS')` | 无结构化示例 | 固定 5 项核对清单 | 是：分类、难度、粒度、认知、遗漏同时核对 |
| P-05 | 模板提取：`template.ts:aiExtractTemplate()`，Prompt 约在 66 行，调用约在 98 行 | `course`、每份真题前 5000 字符拼接值 `texSamples` | 手写 JSON；`parseJson()` 后用 `|| 100/120/[]` 静默补默认 | 有一个正常 JSON 示例；无异常示例 | 中文题型；默认 100 分、120 分钟 | 是：AssessmentTemplate 与抬头 RenderingTemplate 混合提取 |
| P-06 | 模板核对：`template.ts:verifyTemplate()`，Prompt 约在 266 行，调用约在 283 行 | 模板 JSON、真题前 3000 字符 | 自由文本；`includes('VERDICT: PASS')` | 无结构化示例 | 固定题型/题量/分值/时长核对项 | 否，但输出非结构化且不定位证据 |
| P-07 | 难度微调：`difficultyAssigner.ts:tryAdjustWithAI()`，Prompt 约在 234 行，调用约在 264 行 | `target`、当前难度合计、`totalScore`、模板 sections | 手写 JSON `{splits}`；无 Zod；字段名与后续 `SplitRecord` 存在错配风险 | 有一个正常示例；无不可行示例 | “超过 8 分才拆”、容差 ±3%、中文题型 | 是：GenerationPlan 求解和题目子问设计混在一起 |
| P-08 | 整卷生成：`paperGenerator.ts:buildSystemPrompt()` + `buildUserPrompt()`，调用约在 130–136 行 | `course`、`difficulty`、`scope`、`verifyMode`、`ledger`、`setIndex/nSets`、蓝图 Markdown、模板 Markdown、难度 JSON、真题 LaTeX | 单段 LaTeX；`extractLatexBody()` 后直接落盘 | 无完整输出示例 | 8 个变形轴、期末模拟卷、中文章节名、`\\score{n}` | **严重**：题面、答案、rubric、命题说明、格式渲染、去重同时完成 |
| P-09 | 答案验算：`paperGenerator.ts:runVerification()`，Prompt 约在 238 行，调用约在 247 行 | `course`、整卷 LaTeX 前 8000 字符 | 自由文本；正则解析 `TOTAL: n/n` 或统计 PASS/FAIL | 无 JSON 示例 | 只面向“逐题验算” | 是：答案提取、求解和正确性验证混合，且输入可能被截断 |
| P-10 | 质量审核：`paperGenerator.ts:qualityReview()`，Prompt 约在 274 行，调用约在 288 行 | `course`、`setIndex`、整卷 LaTeX 前 6000 字符；函数虽接收 blueprint/template，但 Prompt 未使用 | 自由文本；`includes('REVIEW: PASS')` | 无 JSON 示例 | 固定 5 项清单 | 是：结构、答案、分值、难度、超纲同时审核；结果不阻断交付 |
| P-11 | 导出核对：`compiler.ts:verifyConversion()`，调用约在 226 行 | TeX 源前 2000 字符、转换后文件被当 UTF-8 文本读取的前 2000 字符、`format` | 自由文本；`includes('VERIFY: PASS')` | 无 JSON 示例 | 以 TeX 为事实源 | 否；但 DOCX 是二进制，输入数据本身无效 |
| P-12 | 旧整卷生成：`workflow.ts:buildPaperPrompt()`，调用约在 410–411 行 | `project`、难度、蓝图、模板、真题样本 | 单段 LaTeX | 无完整输出示例 | 总分 100、时长 120、期末卷 | **严重**：题面、答案、rubric、说明、渲染一起生成；整个动态 Prompt 被作为 system message |

P-12 所在的 `step5GeneratePapers()` 没有被当前 `runWorkflow()` 调用；实际路径使用 `paperGenerator.ts:generatePapers()`。它仍是维护风险，因为后续可能被误接回。

## 3. 输入截断与数据边界

| Prompt | 截断方式 | 后果 |
|---|---|---|
| P-01 | 原文 3000，转写 5000 字符 | 后半份题目无法被核对，却可能判整份 PASS |
| P-02 | 原始内容 12000 字符 | 长试卷尾部丢失，调用方没有分页/续传机制 |
| P-03 | 单文件 10000 字符 | 尾部题目会静默消失 |
| P-04 | 只核对前 30 题 | 后续题目不在审核范围 |
| P-05 | 每文件 5000 字符 | 模板尾部大题、答案页和评分栏容易丢失 |
| P-06 | 合计只取 3000 字符 | 不能证明完整模板一致 |
| P-08 | 模板/蓝图各 3000、难度 1500、只取一份真题 2000 | 模型无法看到完整约束，却被要求严格满足全部约束 |
| P-09/P-10 | 整卷 8000/6000 字符 | 后半卷答案和评分标准可能完全未校验 |
| P-11 | 两边各 2000 字符 | 不能证明全文件一致；DOCX 读取方式无效 |

## 4. 当前 Schema 与解析器

| 位置 | 解析方式 | 失败行为 |
|---|---|---|
| `blueprint.ts:parseJsonl()` | 去代码围栏、逐行 `JSON.parse`、检查 required key | 坏行被跳过；数组元素、枚举、分值范围不校验 |
| `template.ts:parseJson()` | 截取第一个 `{` 到最后一个 `}` 后解析 | 缺字段用 100 分/120 分钟/空 sections 补齐 |
| `difficultyAssigner.ts:parseJson()` | 同类手写 JSON 截取 | 异常返回 fallback，未保留原始错误和 AI 输出 |
| `paperGenerator.ts` | LaTeX/Markdown 正则和字符串包含判断 | 非 LaTeX 会尝试启发式转换；结构错误不阻断生成成功 |
| 所有 verdict Prompt | `String.includes()` 或正则计数 | 模型在解释中提到 PASS 也可能误判；没有定位到具体对象 |

## 5. 与目标 12 Prompt 的对应关系

| 目标 Prompt | 当前来源 | 当前状态 |
|---|---|---|
| `document_structure_prompt` | P-02 的部分职责 | 未独立实现 |
| `question_parsing_prompt` | P-03 的切题部分 | 未独立实现 |
| `answer_alignment_prompt` | 无 | 完全缺失 |
| `taxonomy_generation_prompt` | P-03 + `buildKpList()` | 未独立实现 |
| `classification_prompt` | P-03 的分类部分 | 未独立实现 |
| `template_extraction_prompt` | P-05 | 部分实现，Schema/边界不合格 |
| `blueprint_generation_prompt` | P-03 后的确定性聚合 | 没有单独 Prompt；历史/目标/实际未区分 |
| `generation_plan_prompt` | P-07 + P-08 的部分约束 | 未独立实现 |
| `question_generation_prompt` | P-08 | 实现错误：整卷自由文本生成 |
| `answer_generation_prompt` | P-08 | 未独立实现 |
| `rubric_generation_prompt` | P-08 | 未独立实现 |
| `independent_validation_prompt` | P-01/P-04/P-06/P-09/P-10/P-11 | 多套自由文本实现，没有统一 finding Schema |

## 6. 替换后实际状态

截至 2026-08-04，`server/src` 的业务服务已不再直接调用 `sendMessage()`。仓库内调用关系为：

```text
业务服务 -> services/promptRunner.ts:runStructuredPrompt()
         -> prompts/core.ts:renderPrompt()/parsePromptOutput()
         -> services/ai.ts:sendMessage()
```

`rg "sendMessage\\(" server/src` 只剩主 AI 客户端、未使用的旧 `claude.ts` 客户端和 `promptRunner.ts`。

| 替换前 ID | 当前处理 |
|---|---|
| P-01 | `independent_validation_prompt@1.0.0`，严格 finding JSON |
| P-02 | `document_structure_prompt@1.0.0`；模型只识别结构，原始文本由代码保留，不再让模型自由生成 LaTeX |
| P-03 | 顺序调用 `question_parsing_prompt`、`taxonomy_generation_prompt`、`classification_prompt` |
| P-04 | `independent_validation_prompt@1.0.0` |
| P-05 | `question_parsing_prompt` 后调用 `template_extraction_prompt@1.0.0`；缺总分/时长不再由 Prompt 默认补值 |
| P-06 | `independent_validation_prompt@1.0.0` |
| P-07 | `generation_plan_prompt@1.0.0`；输出不满足题位数量或总分时回退确定性调整 |
| P-08 | 按题位依次调用 `question_generation_prompt`、`answer_generation_prompt`、`rubric_generation_prompt`，再独立校验 |
| P-09/P-10 | 合并为 `independent_validation_prompt@1.0.0`；失败会阻断该套生成 |
| P-11 | Markdown 使用 `independent_validation_prompt`；DOCX 使用 ZIP 文件头基本检查，不再把二进制当 UTF-8 Prompt 输入 |
| P-12 | 未调用死路径及其动态 system Prompt 已删除 |

新增但尚无对应阶段服务调用：

- `answer_alignment_prompt`：当前旧流程没有答案候选切分对象，将在答案切分阶段接入。
- `blueprint_generation_prompt`：当前历史矩阵仍由确定性代码聚合；Prompt 已注册，但不应取代后端算术。

当前仍需确认：Prompt id/version 已由 runner 返回，但 AiRun/PromptVersion 的数据库持久化尚未接入，因此还不能声称每次线上调用都已可追溯。
