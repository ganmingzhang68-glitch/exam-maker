# Exam Maker V2 实施报告（P0 里程碑）

日期：2026-08-13  
分支：`feature/product-v2`  
基线审计：`docs/product-v2-gap-analysis.md`

> 本报告只记录实际实现和运行结果。Phase 6–12 尚未完成，本文件不是完整 V2 交付声明。

## Features

| 模块 | 状态 | 实际结果 |
|---|---|---|
| Phase 1 生产任务系统 | COMPLETE | 复用并完善 GenerationJob，增加统一任务中心、真实阶段进度、幂等、取消、失败重试、断点恢复、request_id、模型/token 汇总。 |
| Phase 2 考试测量分析 | COMPLETE | 确定性计算均值、样本标准差、中位数、及格率、经验难度、区分度、点二列相关、Cronbach α；小样本不报告不稳定指标。 |
| Phase 3 题目质量分析 | COMPLETE | QuestionQualityReport、选项分析、质量标记、确认/忽略/待修订、AI 难度预测校准和课程 MAE/RMSE/bias。 |
| Phase 4 AI 辅助批改 | COMPLETE | 严格 Schema 的 Rubric 逐项评分建议、AiRun/PromptVersion、低置信度提醒、教师接受/修改/手工决定、课程批改校准、重启恢复。AI 不直接改最终分。 |
| Phase 5 知识点掌握 | COMPLETE | 透明的分值加权和时间衰减算法、StudentKnowledgeMastery、学生知识点页、教师课程知识点汇总；无逐题耗时时返回空值。 |
| Phase 6 智能错题与专项练习 | NOT_IMPLEMENTED | 本轮未开始，未创建 PracticeSession/PracticePlan/PracticeAttempt。 |
| Phase 7 教师教学分析 | NOT_IMPLEMENTED | 尚无聚合式 TeachingAnalytics Dashboard。 |
| Phase 8 成绩复核 | NOT_IMPLEMENTED | 尚无 GradeReview 流程。 |
| Phase 9 管理员后台 | NOT_IMPLEMENTED | 现有 admin 角色可复用部分教师权限，但没有完整管理员运维页面。 |
| Phase 10 组织架构 | NOT_IMPLEMENTED | 尚无 Organization/UserOrganization，不能声称具备租户隔离。 |
| Phase 11 性能与压力测试 | NOT_IMPLEMENTED | 未执行 100 学生并发、提交峰值和正式 load test。 |
| Phase 12 完整 V2 E2E | PARTIAL | 已完成 P0 页面逐项浏览器巡检；尚未具备 Teacher/Student/Admin 三条完整 V2 流程。 |

## Assessment

实际本地持久库统计：

```text
考试数量: 1
QuestionQualityReport: 4
已完成批改作答: 0
每题有效样本: 0
correct rate: null（样本不足）
empirical difficulty: null（样本不足）
discrimination: null（样本不足）
point-biserial: null（样本不足）
Cronbach alpha: null（样本不足）
```

没有为了展示而补造学生样本。算法正确性由确定性 fixture 测试覆盖，公式见 `docs/assessment-metrics.md`。

## AI Grading

```text
真实持久库 AI 建议数: 0
确定性模拟测试答案数: 1
AI 建议成功数: 1
Schema 失败数: 0（该成功用例）
教师模拟确认测试: 1 次，通过
真实 DeepSeek 主观题批改: NOT RUN
```

未执行真实 DeepSeek 批改的原因：当前真实考试的主观题没有参考答案和可执行 Rubric。页面已禁用 AI 建议按钮，避免模型猜分。真实 AI Key 可用不等于当前数据满足安全批改条件。

## Knowledge

```text
真实持久库 KnowledgePoint: 0
真实持久库 Mastery 记录: 0
知识点掌握 fixture: 3 道题、1 名学生、1 门课程、2 个知识点
fixture 结果: 逆矩阵得分率 0.50，等级 developing
Practice 测试: NOT RUN（Phase 6 未实现）
```

## Performance

```text
concurrent users: NOT RUN
requests: NOT RUN
p50: NOT RUN
p95: NOT RUN
p99: NOT RUN
error rate: NOT RUN
```

前端生产构建仍有约 1.43 MB 单 chunk 的 Vite 警告，尚未做代码分包。一次后续 Server 写盘构建因运行中的 Windows 进程锁住 `server/dist` 而 EPERM；没有停止用户正在运行的系统，改为 `tsc --noEmit` 并通过。此前所有 P0 主要模块完成后的完整根目录生产构建均已实际通过。

## Security

| 场景 | 结果 | 修复/保护 |
|---|---|---|
| 考试质量跨教师访问 | PASS | 后端考试所有权检查，测试返回 403。 |
| 课程难度校准跨教师访问 | PASS | 课程所有权检查，测试返回 403。 |
| AI 批改建议跨教师访问 | PASS | 复用考试所有权和 answer-attempt 绑定检查，测试返回 403。 |
| 知识点班级分析跨教师访问 | PASS | 课程所有权检查，测试返回 403。 |
| AI 直接提交成绩 | PASS | 建议生成后 `final_score` 保持 null；必须由教师确认。 |
| AI 评分 Prompt 注入 | PASS | 学生答案位于 `untrusted_data`，Prompt 测试验证不进入 system message。 |
| AI 评分越过 Rubric 分值 | PASS | Zod Schema 与服务层双重验证单项/总分/冻结 Rubric。 |
| 学生端答案/Rubric 泄漏回归 | PASS | 既有端到端测试继续验证学生 payload 不含 answerKey/scoringRubric。 |
| Organization tenant isolation | NOT_IMPLEMENTED | 当前只有 owner 范围，不具备学校级 tenant 字段。 |

## Browser

### Teacher

实际访问并验证：

- `/teacher/tasks`：真实阶段、状态、错误、模型/token 显示。
- `/exams/1/results`：考试质量、题目质量、人工处置和小样本保护。
- `/courses/1`：AI 难度校准与 AI 批改校准；真实数据不足时指标显示 `—`。
- `/exams/1/attempts/1/grade`：学生答案、参考答案、Rubric、AI 建议、教师评分并列工作台。真实旧题缺 Rubric，AI 按钮正确禁用。
- `/teacher/courses/1/analytics/knowledge`：教师知识点分析空状态。

结果：未观察到失败请求、404、500、横向溢出或 stale loading。存在仓库原有的 Ant Design 静态 message 上下文警告和 React Router v7 future flag 警告。

### Student

实际使用 `test_student` 登录并访问 `/student/learning`。页面显示算法说明和真实空状态；未观察到失败请求、404、500 或布局溢出。

### Admin

NOT RUN。完整管理员后台尚未实现，不能给出 Admin V2 E2E 通过结论。

## Tests

最终完整回归：

```text
command: npm test
total: 97
passed: 96
failed: 0
skipped: 1
skipped reason: 可选真实 AI smoke test 未启用

command: npm run lint
result: PASS，0 warnings（ESLint）

command: npx tsc -p server/tsconfig.json --noEmit
result: PASS

command: npm run build（各主要 P0 模块完成后）
result: PASS
note: 最后仅修改重启恢复逻辑后，写盘重跑被运行中的 Windows Server 锁住 dist；不声称该次写盘构建通过。
```

## Commits

```text
a397bef docs: audit product v2 gaps
146c18a feat: add production task center
370afe8 feat: add assessment quality metrics
ff1845f feat: add question quality reports
a286756 feat: calibrate predicted question difficulty
2c3e7a6 feat: add ai-assisted rubric grading
0af72e7 feat: add student knowledge mastery
f1636fe fix: resume interrupted ai grading
```

## 下一阶段边界

下一次应从 Phase 6 开始，按顺序完成专项练习、教学分析、成绩复核、管理员后台、组织扩展点、性能/安全专项和最终 V2 E2E。不得把本报告中的 P0 里程碑误称为全部 V2 完成。
