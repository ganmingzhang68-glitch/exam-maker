# Product V1 实施报告（当前增量）

> 日期：2026-08-13  
> 分支：`feature/product-v1`  
> 本报告只记录本轮新增内容；AI Prompt 和原有生成流水线没有重复改造。

## 功能完成度

| 模块 | 状态 | 本轮新增 |
|---|---|---|
| Gap Analysis | 已完成 | 完整差距矩阵、优先级、数据/API/浏览器证据 |
| Course | 已完成 | CRUD、软归档、详情、业务统计、课程导航 |
| Class / Enrollment | 已完成 | CRUD、软归档、搜索学生、单个/批量加入、移出/恢复、考试情况计数 |
| 教师 Dashboard | 已完成 | 关键指标、近期考试/试卷、待处理异常、最近活动与快捷入口 |
| 学生 Dashboard | 已完成 | 后端统一考试状态、待办/进行中/即将开始/已完成、课程与最近成绩 |
| 过期 attempt 恢复 | 已完成 | 过期作答自动提交判分，列表/详情/开始考试使用同一状态逻辑 |
| 完整题库 | 已完成 | 多维筛选、排序、复制、批量操作、软归档、详情、版本、引用和真实统计阈值 |
| 试卷库/人工组卷 | 已完成 | 搜索筛选、摘要字段、复制/归档、已使用状态；保留选题、分值、大题与排序 |
| 按班级发布/补考规则 | 未完成 | 下一阶段需增加 exam-class assignment 和 per-student override |
| 强化答题体验 | 部分实现 | 已有自动保存/倒计时；导航、标记、离线队列、交卷摘要未完成 |
| 批改工作台/Gradebook | 部分实现/未完成 | 原有逐学生批改保留；按题批改、改分审计和 Gradebook 未完成 |
| P1 分析/错题本/通知/审计 | 未完成 | 未声明可用 |
| P2 搜索/设置/备份/监控 | 未完成 | 未声明可用 |

## Git

- `d51a2d6 docs: audit product v1 gaps`
- `2a5f09a feat: add course management`
- `0fcde42 feat: add class and enrollment management`
- `bd8ee16 feat: add role dashboards and server exam states`
- `f73f563 feat: complete question bank management`
- `c34245d feat: complete paper library workflow`

## Database

- `010_course_management`：课程学期、授课教师、归档时间，兼容旧 `legacy` 课程。
- `011_class_enrollment`：`teaching_classes`、`enrollments`，唯一关系与状态索引。
- `012_question_bank_v1`：题目课程、来源、生命周期以及 `question_versions`。
- `013_paper_library_v1`：试卷课程关联和创建方式。
- 所有迁移保留旧数据，并通过重复运行/外键测试。

## API

- 新增 `/api/courses` CRUD/归档。
- 新增 `/api/classes` CRUD/归档、学生搜索、Enrollment 单个/批量加入与移除。
- 新增 `/api/dashboard/teacher`、`/api/dashboard/student`。
- 扩展 `/api/questions` 的搜索筛选、批量操作、复制、详情/版本/引用/统计。
- 扩展 `/api/papers` 的搜索筛选、摘要、复制和归档。
- 修复 `/api/exams/mine`、start/questions 与 `/api/attempts/:id` 的过期状态结算。

## Frontend

- 新增教师/学生 Dashboard、课程列表/详情、班级列表/详情、题目详情。
- 侧边栏按角色提供清晰业务导航；出卷项目移动到独立 `/projects`。
- 题库和试卷库补齐产品化筛选及关键元数据。

## Tests

- 最后一次完整 `npm test`：84 passed、0 failed、1 skipped。
- 跳过项为需要真实外部 AI 的 optional live structured prompt smoke test，未声称通过。
- `npm run build`：通过；Vite 仅提示 bundle 大于 500 kB。
- `npm run lint`：通过，0 warning。
- 新增/扩展：课程 API、班级 Enrollment API、Dashboard/过期 attempt、题库版本与安全归档、试卷复制与归档测试。

## Browser

详见 `docs/product-v1-browser-audit.md`。教师和学生关键新增页面均用真实账号和持久化数据检查；已确认原学生考试列表阻断被修复。

## Known Issues

1. 按班级发布尚未实现，现有发布仍兼容地面向全部学生。
2. Gradebook、按题批改和改分审计尚未实现。
3. 答题导航、标记、断线队列和交卷前摘要尚未实现。
4. P1/P2 教学分析、安全审计、通知、全局搜索、备份与监控尚未实现。
5. LaTeX 环境在当前机器仍不可用；本轮没有把“生成 `.tex`”误报为“编译通过”。
