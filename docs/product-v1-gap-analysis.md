# 考试系统 V1 产品差距分析

> 审计日期：2026-08-13  
> 审计分支：`fix/question-generation-pipeline`（开始开发前基线）  
> 判定原则：只有代码、自动化测试或浏览器实测可证明的能力才标为已实现；未实测项标为“需要确认”。

## 1. 基线结论

现有系统已经具备可运行的 AI 出题项目链路、基础题库、组卷、考试发布、学生答题、客观题自动评分、主观题人工评分和结果查看。AI 分阶段 Prompt、结构化输出与持久化不在本轮重复开发范围内。

当前产品仍是“考试流程 MVP”，尚不是按课程和班级长期运营的 V1。最主要的结构缺口是：已有 `courses` 数据表但没有课程 API/UI；没有班级与选课关系；考试发布仍面向全部学生；没有教师/学生 Dashboard、成绩册、审计日志与通知中心；题库、试卷库、批改和结果页只具备基本能力。

浏览器实测还发现一个 P0 阻断：过期的 `in_progress` attempt 没有被后端结算。`GET /api/exams/mine` 把考试标为 `available`，但前端 `StudentExamList` 又因为 `attemptCount === allowedAttempts` 且 `latestAttempt.status === in_progress` 将其放入无法正确恢复的矛盾状态。相关代码位于 `server/src/controllers/attempt.ts` 的 `startExam`、`getStudentExamQuestions`，以及 `client/src/pages/StudentExamList.tsx` 的列表分组和操作列。

## 2. 已审计的实际架构

- 前端：React、React Router、Ant Design、Zustand、Vite；路由入口 `client/src/App.tsx`，页面位于 `client/src/pages/`。
- 后端：Express；入口 `server/src/index.ts`，路由位于 `server/src/routes/`，控制器位于 `server/src/controllers/`。
- 数据库：SQLite + Drizzle ORM；Schema 为 `server/src/db/schema.ts`，迁移位于 `server/src/db/migrations/`。
- 身份认证：JWT；`server/src/middleware/auth.ts` 提供 `requireAuth`、`requireRole`。
- 共享类型与校验：`shared/` workspace；请求/响应结构由 Zod schema 约束。
- 自动化测试：`server/test/*.test.ts`。基线 `npm test` 实测结果为 80 通过、0 失败、1 个 live AI smoke 跳过。

## 3. 模块差距矩阵

| 优先级 | 模块 | 当前状态 | 代码/浏览器证据 | V1 缺口 |
|---|---|---|---|---|
| P0 | Course | 部分实现 | `server/src/db/schema.ts` 已有 `courses`；无 `/api/courses` 路由，`client/src/App.tsx` 无课程页面 | CRUD、归档、课程详情、统计、课程上下文导航 |
| P0 | 班级与 Enrollment | 完全缺失 | Schema 无 class/enrollment 表；考试发布逻辑见 `server/src/controllers/exam.ts` | 班级 CRUD、学生加入/移除、课程关联、按班发布 |
| P0 | 教师 Dashboard | 完全缺失 | 教师 `/` 实测为 `client/src/pages/ProjectList.tsx` | 汇总指标、近期考试、待批改、快捷入口 |
| P0 | 学生 Dashboard | 部分实现 | `client/src/pages/StudentExamList.tsx` 只有考试列表 | 待办/进行中/即将开始/最近成绩；后端统一状态；修复过期 attempt |
| P0 | 完整题库 | 部分实现 | `client/src/pages/QuestionBank.tsx`、`QuestionEdit.tsx`；`server/src/controllers/question.ts` | 课程/考点/关键词/使用状态筛选，排序、归档、批量操作、来源与版本展示 |
| P0 | 题目详情与版本 | 部分实现 | 编辑页存在；已发布考试由 `server/src/services/attemptSnapshot.ts` 固化快照 | 独立详情页、版本表、版本历史与恢复；历史引用保护 |
| P0 | 试卷库 | 部分实现 | `client/src/pages/PaperList.tsx`、`PaperEdit.tsx`；`server/src/controllers/paper.ts` | 搜索筛选、复制/归档、元数据、预览、统一导出入口、按课程组织 |
| P0 | 人工组卷 | 部分实现 | `PaperEdit.tsx` 支持题目增删排序 | 高效题库选择器、按条件筛题、分区结构、分值实时校验 |
| P0 | 考试管理 | 部分实现 | `client/src/pages/ExamList.tsx`、`server/src/controllers/exam.ts` | 课程/班级范围、详情页、草稿编辑限制、重新开放、个别规则 |
| P0 | 补考/重考 | 实现错误 | `allowedAttempts` 为全局字段；发布范围是全部学生 | per-student exception，不修改全班考试规则 |
| P0 | 学生答题体验 | 部分实现 | `client/src/pages/ExamTaking.tsx` 已有 800ms 自动保存、倒计时和手动保存 | 题目导航、答题状态、标记、断线队列、刷新恢复、提交前摘要、超时自动交卷 |
| P0 | 批改工作台 | 部分实现 | `client/src/pages/ExamResults.tsx`、`AttemptGrading.tsx`；`server/src/controllers/result.ts` | 按学生/按题切换、批改进度、Rubric 快捷评分、批量操作 |
| P0 | 成绩册 | 完全缺失 | 无 gradebook 路由、页面和服务 | 课程/班级/考试矩阵、缺考/未交/待批改状态、百分制、导出 |
| P1 | 成绩统计与分布 | 完全缺失 | 无 analytics API/UI | 平均分、中位数、最高/最低、及格率、分布图 |
| P1 | 题目分析 | 完全缺失 | 无正式考试题统计服务 | 得分率、选择分布、区分度、主观题统计 |
| P1 | 经验难度 | 部分实现 | 领域模型支持 difficulty source；无答题统计回写 | 样本量、置信度、经验难度计算，不能小样本冒充可靠结论 |
| P1 | 知识点分析 | 部分实现 | AI 领域模型已有 `knowledgePoints` / classifications | 基于正式作答结果的班级薄弱考点分析 |
| P1 | 学生成绩详情 | 部分实现 | `client/src/pages/StudentResult.tsx`；`getStudentAttemptResult` 按考试开关隐藏答案/解析 | 分数/评语/Rubric 的独立发布策略、班级排名策略（需要确认） |
| P1 | 错题本 | 完全缺失 | 无 wrong-book schema/API/UI | 引用考试 snapshot、按知识点筛选、复习状态 |
| P1 | 通知中心 | 完全缺失 | 无 notifications schema/API/UI | 发布/临近/结束/成绩通知、已读状态 |
| P1 | 操作审计 | 完全缺失 | 仅有 AI `jobEvents`，没有业务审计日志 | 发布、关闭、重开、改分、成员变更、危险操作审计 |
| P1 | 权限专项 | 部分实现 | `server/src/middleware/auth.ts`；`server/test/authorization.test.ts`、`exportAuthorizationApi.test.ts` | 课程/班级资源授权、跨学生成绩与答卷 E2E、越权矩阵 |
| P1 | 文件安全 | 部分实现 | 上传控制器 `server/src/controllers/upload.ts`，导出鉴权 `exportArtifact.ts` | MIME/扩展名双校验、大小/数量限额、路径隔离、恶意文件策略 |
| P1 | 状态/错误/恢复 | 部分实现 | 页面各自显示 message；AI job 支持阶段恢复 | 统一产品状态机、错误码、危险确认、未保存提醒、考试 stale attempt 修复 |
| P2 | 全局搜索 | 完全缺失 | 无 search API/UI | 课程、班级、题目、试卷、考试统一检索 |
| P2 | 系统/课程设置 | 完全缺失 | 无 settings schema/API/UI | 默认时长、成绩展示规则、分页等课程级默认设置 |
| P2 | 数据导出 | 部分实现 | 试卷制品见 `server/src/services/exportArtifacts.ts` | 成绩/名单/考试结果导出，权限与审计 |
| P2 | 备份恢复 | 完全缺失 | 无备份服务 | 数据库与上传制品一致性备份、恢复验证 |
| P2 | 监控健康 | 部分实现 | 基础服务可运行；无产品化 health/metrics | DB、AI、转换器、磁盘健康检查与告警 |
| P2 | 结构化日志 | 部分实现 | AI workflow 有事件日志；HTTP/业务操作无统一结构化日志 | request/user/resource/event/error 关联与敏感字段脱敏 |
| P2 | 响应式与表格体验 | 部分实现 | Ant Design 表格有局部横向滚动 | 常见桌面分辨率、空态、分页、列配置、一致交互 |

## 4. 关键数据模型差距

现有 `courses` 可复用，不应重建；需要增补学期、归档与课程默认设置。新增关系应以外键关联，而不是复制用户资料：

1. `teaching_classes(course_id, teacher_user_id, name, code, status, ...)`
2. `enrollments(class_id, student_user_id, status, joined_at, ...)`，并对 `(class_id, student_user_id)` 唯一约束。
3. `exam_class_assignments(exam_id, class_id, ...)` 与可选的 `exam_student_overrides`。
4. `question_versions(question_id, version_no, snapshot_json, changed_by, ...)`。
5. `grade_audit_logs(attempt_id, answer_id, before_json, after_json, actor_user_id, reason, ...)`。
6. 后续 P1/P2 再新增通知、错题本、业务审计和设置表，避免一次性引入未使用结构。

已有 `attempts.paper_snapshot` 是正确方向，已发布/已开始考试应继续只读取 snapshot，不能因题库编辑而变化。

## 5. API 差距

当前已注册的业务 API 仅覆盖 `/api/auth`、`/api/projects`、`/api/questions`、`/api/papers`、`/api/exams`、`/api/attempts`、`/api/export-artifacts` 和 `/api/similar-question-jobs`（入口 `server/src/index.ts`）。新增 API 应按资源组织：

- P0：`/api/courses`、`/api/classes`、`/api/dashboard/teacher`、`/api/dashboard/student`、`/api/gradebook`。
- 扩展既有：题库筛选/归档/版本，试卷复制/归档，考试按班发布、详情与个别规则，attempt 恢复/导航/超时结算，批改审计。
- P1/P2：`/api/analytics`、`/api/notifications`、`/api/audit-logs`、`/api/search`、`/api/settings`、`/api/health`。

所有写接口必须使用共享 Zod schema；所有资源 API 必须同时检查角色与资源归属。

## 6. 浏览器基线审计

使用已启动的 `http://localhost:5173` 进行了教师和学生真实浏览器巡检：

- 教师首页实际为“我的出卷项目”，不是 Dashboard。
- AI 项目创建、相似题生成、题库、试卷库和考试列表页面均可加载；未观察到控制台、页面或网络错误。
- 考试创建页明确提示“MVP 发布范围为当前所有学生账号”，证明尚未接入班级。
- 学生“我的考试”页面显示当前 0、历史 0，但同一登录态直接请求 `/api/exams/mine` 返回一场 `available` 考试及一个已过期的 `in_progress` attempt。此处是后端状态计算与前端展示共同造成的确定性缺陷。
- 学生答题页具备自动保存和倒计时；断网重试、题目导航、标记和提交摘要未实现。

详细浏览器巡检将在开发后记录到 `docs/product-v1-browser-audit.md`。

## 7. 实施边界与顺序

本轮不重复实现已经完成的 AI Prompt 流水线、结构化生成、试卷三格式导出底座和基础考试快照。按 `新需求.md` 的优先级，先完成 P0：

1. Course；
2. 班级与 Enrollment；
3. 教师/学生 Dashboard，并修复 stale attempt；
4. 完整题库及版本保护；
5. 试卷库和人工组卷；
6. 考试生命周期、学生答题恢复、批改工作台和 Gradebook；
7. 完整 P0 E2E 后再进入 P1/P2。

每个业务模块使用独立迁移（如需要）、独立 API/前端/测试和独立 Git commit，保留旧数据和现有可用流程。

## 8. 需要确认的业务规则

- 一个课程是否允许多名教师共同管理；当前暂按单一 owner 实现。
- 学号是否全局唯一，或只需在课程/班级内唯一。
- 补考是增加一次 attempt、延长时间，还是分配独立试卷；建议使用 per-student override。
- 成绩发布是否区分分数、标准答案、解析、Rubric 和教师评语五个独立开关。
- 课程删除采用归档还是允许无历史数据时物理删除；建议统一归档。
- 成绩册的最终成绩取最后一次、最高一次还是教师指定 attempt。
- 经验难度的最低样本量和置信度分级阈值。
