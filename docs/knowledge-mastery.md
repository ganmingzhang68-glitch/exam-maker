# 知识点掌握分析

## 计算范围

V2 只使用已完成人工/客观判分、状态为 `graded` 的考试作答。题目通过课程考点体系中的名称、代码、别名或生成题分类记录关联到一个或多个知识点。一题关联多个知识点时，对每个知识点独立形成证据，不把考试成绩和练习成绩混合。

当前版本没有逐题可靠作答时长，API 明确返回 `timeSpentSeconds: null`，页面不展示虚构耗时。

## 可解释算法

每条证据包含题目实际得分、题目满分、考试和批改时间。近期证据使用指数时间衰减：

```text
weight = 2 ^ (-age_days / half_life_days)
score_rate = Σ(actual_score × weight) / Σ(max_score × weight)
```

默认半衰期 90 天，近期表现窗口 30 天。配置项：

- `MASTERY_MIN_QUESTIONS`（默认 3）
- `MASTERY_HALF_LIFE_DAYS`（默认 90）
- `MASTERY_RECENT_DAYS`（默认 30）
- `MASTERY_MASTERED_RATE`（默认 0.85）
- `MASTERY_GOOD_RATE`（默认 0.70）
- `MASTERY_DEVELOPING_RATE`（默认 0.50）

样本不足时等级固定为 `insufficient_data`，即使当前得分率很高也不显示“已掌握”。产品语言使用“建议重点复习”，不使用给学生贴标签的表述。

## 持久化与接口

`student_knowledge_mastery` 按学生、课程、知识点唯一保存当前可重算结果，并记录算法版本 `weighted-score-v1`。

- `GET /api/learning/student`：学生读取自己的课程知识点表现。
- `GET /api/learning/courses/:id`：课程所有者/管理员读取班级汇总。
- `/student/learning`：学生知识点表现页面。
- `/teacher/courses/:id/analytics/knowledge`：教师课程知识点分析页面。

查询会从最新已批改数据确定性重算，后续专项练习模块可在保持来源隔离的前提下增加练习证据。
