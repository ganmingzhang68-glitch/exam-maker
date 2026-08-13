# Exam Maker V2 浏览器巡检报告

日期：2026-08-13

分支：`feature/product-v2`

浏览器：Microsoft Edge（Chromium，CDP 9223）

前端/后端：`http://localhost:5173` / `http://localhost:3001`

## 结论

Phase 12 的 Teacher、Student、Admin 三类角色均已使用真实浏览器、真实前端和本地持久数据库执行核心流程。核心导航、接口和布局均可用；巡检期间没有业务接口 404/500、失败网络请求、横向溢出、永久 loading、`undefined`/`null` 泄漏到新增 V2 页面或越权页面。真实 AI 主观题建议未满足数据与授权前置条件，因此整体标记为 PARTIAL，而不是完整通过。

唯一仍可复现的前端控制台问题是 Ant Design 静态 `message` / `Modal` API 在动态主题上下文中的警告。它不会阻断业务，但由 Ant Design 通过 `console.error` 输出，因此本报告不将控制台标记为完全干净。

## 测试数据

- 教师：`test_teacher`
- 学生：`test_student`
- 管理员：`test_admin`
- 浏览器 fixture：课程 ID 3、班级 ID 2、题目 ID 47、试卷 ID 2、考试 ID 2
- 题目：单选题“2 + 3 = ?”，10 分，标准答案 `B. 5`
- 测试过程中创建：正式考试作答 ID 2、错题练习会话 ID 1、成绩复核 1 条

测试账号由 `server/src/seed.ts` 幂等创建或重置；种子过程不会删除已有业务数据。

## Teacher 流程

实际验证：

1. 登录后进入 Dashboard、课程、考试管理和后台任务中心。
2. 打开 `/exams/2/results`，显示 1 个有效样本、平均分 0/10、经验难度 100%，并明确提示少于 5 人时不报告区分度、点二列相关和信度。
3. 展开选择题选项分析，看到 A 选择率 100%、B 选择率 0%、C 选择率 0%；规则状态分别为 `effective`、正确选项、`unused`。
4. 点击“待修订”，随后通过带教师令牌的 `/api/exams/2/quality` 查询，确认题目质量报告状态为 `needs_revision`。
5. 打开 `/exams/1/attempts/1/grade`，看到学生答案、参考答案、Rubric、AI 建议和教师最终评分区域。旧题缺少 Rubric 时，“生成建议”按钮确实为 disabled。
6. 打开 `/teacher/courses/1/analytics/knowledge` 和 `/teacher/courses/1/analytics`，空数据使用明确空状态，不伪造班级知识点结论。
7. 打开 `/teacher/grade-reviews`，看到学生刚提交的 `pending` 复核申请。

未执行真实 DeepSeek 主观题批改：当前真实主观题没有可执行 Rubric，且没有获得把该学生答案发送给外部模型的专项授权。自动化测试使用受控 mock 验证 AI Schema、失败恢复和教师确认逻辑。

## Student 流程

实际验证：

1. 登录并在 `/student/exams` 看到已发布考试。
2. 进入 `/attempts/2`，选择错误答案 `A. 4`；提交前确认框出现，提交操作会 flush 未确认保存的答案。
3. `/attempts/2/result` 显示 0/10、我的答案、标准答案和解析，说明发布配置生效。
4. 点击“申请成绩复核”，填写理由与补充依据；`/student/grade-reviews` 出现一条 `pending` 记录，成绩没有被直接修改。
5. 在 `/student/practice` 选择课程、错题练习、题量 1，创建真实错题练习。
6. 在 `/student/practice/1` 选择 `B. 5` 并提交，结果为 10/10，显示标准答案和解析；页面明确说明练习成绩不计入正式 Gradebook。
7. 打开 `/student/learning`；由于该浏览器 fixture 没有关联考点，页面正确显示“课程尚未建立考点体系”，没有编造掌握度。

最终学生流程捕获结果：HTTP 错误 0、failed request 0、横向溢出 0。

## Admin 流程

实际验证：

1. 使用 `test_admin` 登录并进入 `/admin`。
2. 系统概览显示数据库健康、用户/课程/考试/任务和 AI 调用聚合。
3. 用户管理显示创建、禁用、恢复/重置登录状态入口；DOM 未出现密码、密码哈希或 token。
4. 打开组织管理、AI 成本配置、审计日志；审计无数据时显示明确空状态。
5. 从管理员导航进入 `/teacher/tasks`，显示真实的 6/6 阶段进度、耗时和任务结果。

最终管理员流程捕获结果：业务 HTTP 错误 0、failed request 0、横向溢出 0。

## Playwright 巡检项

| 检查项 | 结果 | 说明 |
|---|---|---|
| `console.error` | PARTIAL | 仅发现 Ant Design 静态 message/Modal 上下文警告；无业务异常堆栈。 |
| failed network requests | PASS | 最终三角色流程均为 0。 |
| 404 / 500 | PASS | 未观察到。 |
| layout overflow | PASS | 740px 视口下 `scrollWidth === clientWidth`。 |
| undefined / null | PASS | 新增 V2 页面未显示；旧主观题的标准答案区域显示 `null`，属于历史脏数据，见已知问题。 |
| broken navigation | PASS | 三角色主导航与深链接均可进入。 |
| stale loading | PASS | 未观察到永久加载状态。 |
| empty states | PASS | 知识点、审计日志等无数据页面有明确说明。 |
| permission errors | PASS | 不同角色导航和后端授权测试均符合预期。 |

## 已知问题

1. 旧考试 ID 1 的四道主观题存在历史导入脏数据：标准答案为 `null`、题干混入 LaTeX 答案片段、Rubric 缺失。V2 批改页没有猜测或发送这些答案给 AI，而是禁用生成建议；数据修复需回到真题解析/题库审核流程处理。
2. Ant Design 静态 `message` / `Modal` API 在动态主题下产生控制台警告。彻底消除需要把全站静态调用逐页迁移为 `App.useApp()`，不影响本阶段业务闭环。
3. 浏览器 fixture 没有关联 KnowledgePoint，因此知识点页验证的是可靠空状态；确定性知识点计算由服务与 API 测试覆盖。
