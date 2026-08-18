# Product V2 Gap Analysis

> 审计日期：2026-08-13  
> 基线分支：`feature/product-v1`，提交 `904cacf`  
> 状态定义：`COMPLETE` 已由代码和实际测试证明；`PARTIAL` 仅实现部分要求；`MISSING` 不存在；`BROKEN` 已发现确定性错误；`NEEDS_REDESIGN` 现有实现无法安全扩展。

## 1. 基线核验

`新需求2.md` 声称 V1 已有成绩册、考试分析、错题、通知、业务审计、基础运维和 V1 E2E，与实际仓库不一致。代码中不存在这些模型、API 或页面，因此不能作为 V2 的已完成基础。

实际存在并可复用：AI 真题/相似题分阶段流水线、Zod 结构化 Prompt、AI run 元数据、课程、班级/Enrollment、教师/学生 Dashboard、题库/QuestionVersion、试卷库、考试发布、学生答题自动保存、客观题评分、主观题人工评分和不可变考试快照。

## 2. 审计证据

- 数据库：`server/src/db/schema.ts`，迁移至 `013_paper_library_v1`。
- 后端入口：`server/src/index.ts`；当前没有 task center、analytics、AI grading、mastery、practice、grade review、admin 或 organization 路由。
- 前端路由：`client/src/App.tsx`；当前没有 `/teacher/tasks`、考试质量、`/student/learning`、教师知识分析或 admin 页面。
- Question/QuestionVersion：`questions`、`question_versions` 已存在，题目编辑保存旧版本。
- Paper/Exam/Attempt/Answer：已有，考试启动时使用 `attempts.paper_snapshot` 固化题目；没有 Grade 实体，成绩保存在 `attempts` 和 `answers`。
- KnowledgePoint：AI 领域表 `knowledge_points` 和题库 JSON `questions.knowledge_points` 并存，正式考试统计尚未统一关联。
- WrongQuestion/AuditLog：不存在。
- GenerationJob：`generation_jobs`、`generation_job_stages`、`similar_question_jobs`、`similar_question_job_stages`、`ai_runs` 已存在。

## 3. 回归基线（实际执行）

| 命令 | 结果 |
|---|---|
| `npm test` | 84 passed，0 failed，1 skipped；跳过项为可选 live AI smoke |
| `npm run build` | 通过；Vite 提示主 bundle 大于 500 kB |
| `npm run lint` | 通过，0 warning |
| `npm run e2e:similar-question` | 通过；真实生成 job `#5`，生成 1 题并保存题目 `#46` |

## 4. 浏览器基线

使用隔离的 headless Edge CDP 实际登录：

- Teacher：`/` 正常加载教师工作台，显示 2 门课程、1 个班级、1 场考试、1 个待批改和 1 个近七日提交；无 4xx/5xx。
- Student：`/student/dashboard` 正常加载，显示已完成 1；无 4xx/5xx。
- 两种角色登录时均出现 Ant Design 静态 `message` 无法消费动态 theme context 的 console warning，不是功能阻断。
- Admin：没有后台页面，无法执行 admin browser flow。

## 5. 功能差距矩阵

| 优先级 | 模块 | 状态 | 实际情况与缺口 |
|---|---|---|---|
| P0 | Production Job System | PARTIAL | AI job/stage/attempt 与重启恢复已存在；相似题通过 202 + polling 异步运行且成功阶段有缓存。缺统一状态、request id/幂等、取消、blocked/retrying、成本、统一任务 API/页面；完整项目 workflow 仍有进程内执行路径 |
| P0 | 后台任务中心 | MISSING | 无 `/teacher/tasks`、统一任务列表或详情 API |
| P0 | Assessment Metrics | MISSING | 无 correct rate、经验难度、区分度、点二列相关或 Cronbach alpha 服务/表/UI |
| P0 | Question Quality | MISSING | 无 QuestionQualityReport、选项分析或 quality flags；题库已有 `lifecycle_status` 但无 `needs_review` |
| P0 | 难度校准 | PARTIAL | AI 领域 difficulty 已区分 predicted/teacher/empirical schema，但正式考试没有 calibration record 或 MAE/RMSE/bias |
| P0 | AI-assisted Grading | MISSING | 人工评分存在；无 AiGradingSuggestion、独立 Prompt、Schema、AI run 或教师接受/修改工作流 |
| P0 | Knowledge Mastery | MISSING | 有 KnowledgePoint；无 StudentKnowledgeMastery 计算、阈值配置或 `/student/learning` |
| P1 | Practice System | MISSING | 无 wrong book、PracticeSession/Plan/Attempt；现有相似题管线可作为变式生成底座 |
| P1 | Teaching Analytics | MISSING | Dashboard 只有运营统计，无知识点弱项、题目质量或学生关注规则 |
| P1 | Grade Review | MISSING | 无申请/处理流程和 GradeAuditLog；当前人工评分直接覆盖答案分数 |
| P1 | Admin Dashboard | MISSING | `admin` 角色存在于 auth/权限，但无用户/任务/AI 使用/健康/审计 UI/API |
| P1 Eng | Load Testing | MISSING | 无并发 autosave/submit、提交峰值或 AI 并行压力脚本 |
| P1 Eng | DB Query Optimization | PARTIAL | 高频列有部分索引；Dashboard、班级考试计数存在明显 N+1，未基准测量 |
| P1 Eng | Security Audit | PARTIAL | JWT、角色/owner、答卷/制品隔离有测试；缺 request id、rate limit、CSRF 决策文档、全量 IDOR/tenant/mass-assignment 与上传安全测试 |
| P1 Eng | AI Usage Analytics | PARTIAL | `ai_runs` 有 model/token/latency/error；无聚合 API、功能/课程维度、价格配置或 estimated cost |
| P2 | Organization Support | MISSING | 无 Organization/UserOrganization；资源无 organization_id |
| P2 | Cost Analytics | MISSING | 无 AiCostConfig、有效期价格或成本估算 |
| P2 | Data Retention | MISSING | 无 `docs/data-retention-policy.md`；在业务规则确认前不应自动删除 |
| P2 | UX Polish | PARTIAL | 核心页面可用；有 Ant Design 静态 message warning、bundle 过大，尚无完整 V2 状态/空态巡检 |

## 6. Production Job 具体差距

### 可复用

- `server/src/services/generationJobService.ts`：阶段 attempt number、输入/输出、错误/stack、retryable、起止时间。
- `server/src/services/similarQuestionPipeline.ts`：成功阶段缓存，不重复执行；失败重试；服务重启把 running stage 标失败并恢复 pending/running job。
- `server/src/services/promptRunner.ts` / `ai_runs`：模型、PromptVersion、token、retry、latency、错误。

### 必须补齐

1. 在现有表之上做统一只读/控制视图，不另造第三套任务引擎。
2. job 增加 `request_id`、`idempotency_key`、`cancel_requested_at`、`finished_at`；状态统一映射到 queued/running/retrying/succeeded/failed/cancelled/blocked。
3. 阶段循环必须在边界检查取消；running 工作不能声称可强杀模型请求，取消语义为“当前调用返回后停止后续阶段”。
4. 任务进度使用成功阶段数/总阶段数，不制造百分比。
5. 成本必须由版本化模型价格配置推导并标为 estimated；未配置时为 null。
6. API 必须按 requested_by / project owner 隔离。

## 7. 测量与质量分析设计边界

- 所有指标使用 TypeScript 确定性函数，不调用 LLM。
- 有效样本仅包括已提交且已有 final score 的 attempt/answer。
- 客观题 `empirical_correct_rate = correct / valid`；统一难度方向为 `empirical_difficulty = 1 - correct_rate`。
- 默认高低分组比例、最低样本、通过分数、质量阈值集中配置，不散落 magic number。
- 点二列相关使用题目得分和“扣除该题后的总分”以降低 part-whole inflation。
- Cronbach alpha 只在足够学生、至少两题且题目方差有效时报告。
- 所有 insufficient sample 都返回状态，不给确定性评价。
- 题目统计必须基于 `paper_questions.question_snapshot` / attempt snapshot，不能被后续题库修改污染。

## 8. 安全与稳定性发现

- `server/src/index.ts` 没有 request-id middleware，错误响应不能关联日志。
- 没有 rate limit；login/AI/upload/export 均未保护，autosave 也没有独立策略。
- CORS 固定 localhost，JWT 存 localStorage；当前不是 cookie auth，传统 cookie CSRF 风险较低，但 XSS 后果高，需要文档化并持续避免不可信 HTML。
- 前端搜索未发现 `dangerouslySetInnerHTML`；题干主要使用 React 文本节点/`pre`，此点当前安全。
- 上传内容在 Prompt 设计中被标为 data，Prompt 注入已有自动化测试；文件 MIME/扩展/大小/路径专项仍不完整。
- 部分更新采用展开已解析 Zod data，但 V2 写接口仍需 strict schema，禁止直接 mass assignment。

## 9. 实施顺序

按照需求优先级，先从现有基础增量实现：

1. Phase 1：统一任务中心与生产错误 request id；
2. Phase 2/3：确定性考试指标、题目质量报告和考试质量 UI；
3. Phase 4：仅 suggestion 的 AI Rubric 批改；
4. Phase 5：透明的知识点掌握分析；
5. 完整回归后再进入 Practice、Teaching Analytics、Grade Review、Admin 和工程 P1。

未实现模块必须继续标为 MISSING/PARTIAL，不能因文档目标而宣称可用。
