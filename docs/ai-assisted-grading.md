# AI 辅助主观题批改

## 产品边界

AI 只生成评分建议，不直接写入 `answers.final_score`。教师必须在批改工作台执行“接受 AI 建议”“修改后保存”或“完全手工评分”，最终成绩才会更新。低置信度建议显示“建议人工重点复核”。

## 数据与状态

`ai_grading_suggestions` 保存题目答案关联、建议分、逐项评分、可展示评分依据摘要、匹配/缺失要点、置信度、模型、Prompt 版本和 `AiRun`。状态为：

```text
queued → running → succeeded → accepted | modified
                    ↘ failed
```

重新生成时，未被教师处置的旧成功建议标记为 `superseded`；历史预测不删除。教师处置时记录最终分、与建议分的差异、教师和时间。

## 安全和校验

- `ai_grading_prompt@1.0.0` 将学生答案和题干放在 `untrusted_data`，不把其中内容当作系统指令。
- 输出经过严格 Zod Schema；禁止额外字段、最终成绩和思维链字段。
- Schema 校验逐项得分不超过单项满分，逐项之和等于建议总分，建议分不超过总分。
- 服务层再次校验输出总分、Rubric ID 和每项满分与冻结作答快照一致。
- 缺少参考答案或可执行 Rubric 时拒绝创建建议，不进行猜测评分。
- 所有读取、生成和教师确认接口复用考试所有权检查。

## 接口

- `POST /api/exams/:examId/attempts/:attemptId/answers/:answerId/ai-suggestion`：创建后台建议任务，返回 202。
- `GET /api/exams/:examId/attempts/:attemptId/answers/:answerId/ai-suggestion`：读取最新建议及状态。
- `PATCH /api/exams/:examId/attempts/:attemptId/answers/:answerId/grade`：新增 `gradingMode` 与 `aiSuggestionId`，最终决定仍由教师提交。

当前生成过程使用持久化建议状态和 `AiRun` 失败记录。运行中的供应商请求不能被强制中断；失败不会改动学生成绩。

## 批改质量反馈

教师实际处置后的建议进入课程级 `GradingCalibration`。确定性代码计算：

- MAE：AI 建议分与教师最终分绝对误差的平均值。
- bias：`AI 建议分 - 教师最终分` 的平均值。
- 接受率与修改率：教师处置状态的真实比例。

默认至少 5 条处置记录（`ASSESSMENT_MIN_GRADING_CALIBRATION_RECORDS`）才展示汇总指标；不足时所有汇总指标为空。`GET /api/courses/:id/grading-calibration` 返回课程汇总、按题型和按 Rubric 分组结果；课程详情“AI 批改校准”页展示真实数据。
