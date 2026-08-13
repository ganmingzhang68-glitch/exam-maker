# Exam Maker V2 实施报告

日期：2026-08-13  
分支：`feature/product-v2`  
基线审计：`docs/product-v2-gap-analysis.md`

> 本报告只记录实际实现和实际运行结果。没有执行的外部 AI 调用、LaTeX 编译或浏览器场景会明确标注，不以 mock 或源码存在替代运行结论。

## Features

| 模块 | 状态 | 实际结果 |
|---|---|---|
| Phase 1 生产任务系统 | COMPLETE | 统一任务中心、真实阶段进度、幂等、取消、失败重试、断点恢复、request_id、模型/token/耗时记录。 |
| Phase 2 考试测量分析 | COMPLETE | 确定性计算均值、样本标准差、中位数、及格率、经验难度、区分度、点二列相关、Cronbach α；小样本保护。 |
| Phase 3 题目质量分析 | COMPLETE | QuestionQualityReport、选项分析、质量标记、确认/忽略/待修订、难度校准。 |
| Phase 4 AI 辅助批改 | COMPLETE | Rubric 逐项建议、严格 Schema、AiRun/PromptVersion、教师确认与校准；AI 不直接改最终分。 |
| Phase 5 知识点掌握 | COMPLETE | 分值加权与时间衰减、StudentKnowledgeMastery、学生与教师知识点页面。 |
| Phase 6 智能错题与专项练习 | PARTIAL | PracticeSession/Plan/Attempt、错题/知识点/薄弱点模式、审核题库优先、题库缺口显式返回、练习证据独立更新掌握度；学生端 AI 变式生成尚未接入。 |
| Phase 7 教师教学分析 | COMPLETE | 课程级确定性快照，聚合考试、知识点、题目质量、难度误差、参与和练习，并输出透明关注规则。 |
| Phase 8 成绩复核 | COMPLETE | 有时窗的申请/处理流程、仅教师可改分、GradeAuditLog、总分重算和掌握度刷新。 |
| Phase 9 管理员后台 | COMPLETE | 用户、任务、AI 用量、成本配置、健康状态、审计；禁用及重置登录使旧 token 失效，页面不展示敏感凭据。 |
| Phase 10 组织架构 | COMPLETE | Organization/UserOrganization 及核心资源 organization_id；请求组织上下文、IDOR 和 tenant isolation 测试。属于兼容扩展点，不宣称完整 SaaS。 |
| Phase 11 性能与压力测试 | COMPLETE | 高频索引、限流、上传加固、request_id、100 学生进入/保存/重复提交/成绩册负载测试和安全/保留策略文档。 |
| Phase 12 完整 V2 E2E | PARTIAL | Teacher、Student、Admin 三角色真实浏览器核心流程已执行；真实 AI 主观题建议因数据/授权前置条件未执行，控制台仍有 Ant Design 警告。细节见 `docs/product-v2-browser-audit.md`。 |

## Phase 6–12 交付摘要

### Phase 6

- 数据库：迁移 020，新增 `practice_sessions`、`practice_plans`、`practice_attempts`。
- API：`/api/practice/options`、`/api/practice/sessions` 及逐题提交。
- 前端：`/student/practice`、`/student/practice/:id`。
- 约束：只选择已审核且有答案的客观题；题库不足明确返回 shortage，不绕过生成流水线调用 AI。

### Phase 7

- 数据库：迁移 021，新增 `teaching_analytics_snapshots`。
- API：`GET/POST /api/teaching-analytics/courses/:id`。
- 前端：`/teacher/courses/:id/analytics`。

### Phase 8

- 数据库：迁移 022，新增 `grade_reviews`、`grade_audit_logs` 和考试复核配置。
- API：学生申请、教师列表与处理接口。
- 前端：`/student/grade-reviews`、`/teacher/grade-reviews`，学生成绩页可直接发起。

### Phase 9

- 数据库：迁移 023，新增用户启停/令牌版本、系统审计、AI 成本配置。
- API/UI：`/api/admin/*` 与 `/admin`。
- 安全：管理员聚合接口不查询学生答案正文；禁用或重置登录状态会使已有 token 失效。

### Phase 10

- 数据库：迁移 024，新增组织成员关系，并给 Course/Class/Question/Paper/Exam 增加 `organization_id` 和默认组织回填。
- API/UI：组织上下文切换与管理员组织管理。
- 授权：核心资源查询同时验证 owner/role 与 organization_id。

### Phase 11

- 数据库：迁移 025，按实际考试、成绩册、质量报告和任务查询增加组合索引。
- 工程：登录、上传、AI 出题、AI 批改和导出限流；autosave 不受昂贵接口限流影响。
- 安全：上传前置鉴权、文件签名和路径边界检查；统一 request_id 返回给前端。

### Phase 12

- 增加可重复的教师、学生、管理员测试账号种子数据，并确保默认组织成员关系。
- 使用真实 Edge/Chromium 前端完成考试、错题、练习、复核、质量分析、待修订、任务和管理后台流程。
- 没有删除浏览器 fixture 或现有业务数据。

## Assessment

本地持久库在 Phase 12 浏览器验证后的实际结果：

```text
考试数量: 2
浏览器有效作答样本: 1
浏览器题目样本: 1
correct rate: 0.00
empirical difficulty: 1.00
discrimination: null（样本少于 5）
point-biserial: null（样本少于 5）
Cronbach alpha: null（样本少于 5）
```

系统没有为了得到漂亮指标而伪造学生样本。统计算法的多样本场景由确定性测试覆盖，公式见 `docs/assessment-metrics.md`。

## AI Grading

```text
真实持久库 AI 建议数: 0
确定性模拟测试答案数: 1
AI 建议成功数: 1
Schema 失败数: 0（成功 fixture）
教师模拟确认测试: 1 次，通过
真实 DeepSeek 主观题批改: NOT RUN
```

未运行真实批改的原因：当前真实主观题没有可执行 Rubric，浏览器确认“生成建议”按钮处于禁用状态；同时没有获得把该学生答案发送给外部模型的专项授权。

## Knowledge

```text
真实持久库 KnowledgePoint: 0
真实持久库 Mastery 记录: 0
知识点算法 fixture: 3 道题、1 名学生、1 门课程、2 个知识点
fixture 结果: 逆矩阵得分率 0.50，等级 developing
真实 PracticeSession: 1
真实 PracticeAttempt: 1，答对 1，得分 10/10
```

练习证据和考试成绩存储隔离，未混入 Gradebook。浏览器 fixture 未绑定考点，因此学生知识点页显示可靠空状态。

## Performance

Phase 11 实际负载结果：

| 场景 | 并发/请求 | p50 | p95 | p99/最大值 | 错误率 |
|---|---:|---:|---:|---:|---:|
| 同时进入考试 | 100 | 384.6 ms | 507.9 ms | max 524.4 ms | 0% |
| 同时保存答案 | 100 | 248.4 ms | 252.7 ms | max 262.3 ms | 0% |
| 提交峰值（含重复提交） | 200 | 473.8 ms | 581.2 ms | max 581.8 ms | 0% |
| 教师打开成绩册 | 1 | 24.5 ms | 24.5 ms | 24.5 ms | 0% |

提交后实际检查：100 attempts、100 answers、100 graded；重复计分 0、数据丢失 0、HTTP 错误 0。完整参数和机器环境见 `docs/performance-report.md`。

## Security

| 测试场景 | 结果 | 修复/保护 |
|---|---|---|
| IDOR 与跨组织访问 | PASS | organization middleware、资源 organization_id 和 tenant isolation API 测试。 |
| 学生答案/Rubric 泄漏 | PASS | 学生考试 payload 不包含 answerKey/scoringRubric；结果仅按发布配置显示。 |
| AI 直接提交成绩 | PASS | suggestion 与 final score 分离，必须教师确认。 |
| AI Prompt 注入 | PASS | 学生答案/上传内容处于 `untrusted_data`，不进入 system message。 |
| Rubric 越界评分 | PASS | Zod Schema 与服务层验证单项之和、总分上限和冻结 Rubric。 |
| 管理员敏感字段泄漏 | PASS | API/UI 不返回密码哈希或 token。 |
| 禁用账号继续使用旧 token | PASS | `is_active` + `token_version` 双重校验。 |
| 文件上传/path traversal | PASS | 鉴权前置、扩展名与签名检查、路径解析边界检查。 |
| 昂贵接口滥用 | PASS | 登录、上传、AI、导出限流；autosave 单独保护可用性。 |

安全审计详情见 `docs/security-audit-v2.md`。

## Browser

- Teacher：考试质量、经验难度、选项分析、待修订、AI 批改保护、知识点分析、复核列表均实际访问。
- Student：参加考试、错答、自动判分、成绩/答案显示、创建并完成错题练习、知识点页、发起复核均实际执行。
- Admin：用户、组织、AI 用量、成本配置、系统健康、任务和审计均实际访问。

业务请求没有 404/500、failed request 或布局溢出。Ant Design 静态 message/Modal 上下文警告仍会通过 `console.error` 输出，详见 `docs/product-v2-browser-audit.md`。

## Tests

阶段 6–11 的模块提交前均运行了对应测试。最终完整回归记录：

```text
command: npm test
total: 104
passed: 103
failed: 0
skipped: 1
skipped reason: 可选真实 AI smoke test 未启用

command: npm run lint
result: PASS，0 warnings

command: npx tsc -p server/tsconfig.json --noEmit
result: PASS

command: npm run build -w shared
result: PASS

command: npm run build -w client
result: PASS（Vite 仍提示单 chunk 约 1.43 MB）
```

导出测试确实生成 Markdown、DOCX 和 TeX；运行环境没有可用 LaTeX 编译器，因此不能声称 PDF 编译通过。DOCX 通过 ZIP/核心文件完整性检查。

## Commits

```text
705bc93 feat: add student practice sessions
0122651 feat: add teaching analytics snapshots
bc2e8be feat: add auditable grade reviews
7deccfa feat: add secure admin console
4c98a7b feat: add organization boundaries
d76c2a5 perf: harden and load test exam delivery
```

Phase 12 的浏览器审计、测试账号种子和本报告随 Phase 12 独立提交。

## 仍需后续处理

1. 将全站 Ant Design 静态 `message` / `Modal` 迁移到 `App.useApp()`，清除动态主题控制台警告。
2. 修复旧考试 ID 1 的历史脏题数据（答案 `null`、题干混入答案 LaTeX、Rubric 缺失）；V2 已通过禁用 AI 建议避免继续放大错误。
3. 前端生产包仍需按路由拆分 chunk；这不影响本轮 100 人 API 负载结果。
4. 自动数据删除未启用，需教师/学校确认保留期限后再执行 `docs/data-retention-policy.md`。
5. 学生练习当前只使用已审核题库。AI 变式不能绕过现有生成、答案、Rubric、校验、相似度和教师审核流水线；把该完整异步链路接入练习仍是后续工作。
