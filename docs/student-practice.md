# 学生自主练习（Phase 6）

## 已实现

- `PracticeSession`、`PracticePlan`、逐题 `PracticeAttempt` 持久化。
- 错题、指定知识点、薄弱点三种选题模式。
- 仅从当前课程已审核、包含标准答案且可自动判分的客观题中选题。
- 题库不足时保存结构化缺口并在 API/页面明确展示；不会静默调用 AI。
- 练习结束前不返回标准答案；完成后返回答案和解析。
- 练习分数与正式考试成绩完全分开；练习结果以独立证据更新知识点掌握度。
- 学生只能访问自己的练习，且必须已加入对应课程。

## 暂不包含

- 主观题自动批改：为避免未经教师确认的 AI 分数进入学习画像，本阶段仅支持客观题可靠闭环。
- AI 变式补题：现有完整 AI 题目生成流水线是教师侧异步审核流程，不能绕过审核直接泄露给学生。题库不足会明确提示教师补充并审核题目。

## API

- `GET /api/practice/options`
- `GET /api/practice/sessions`
- `POST /api/practice/sessions`
- `GET /api/practice/sessions/:id`
- `PUT /api/practice/sessions/:id/items/:itemId`

## 前端

- `/student/practice`
- `/student/practice/:id`
