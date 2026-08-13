# 成绩复核（Phase 8）

- 教师在考试草稿中显式启用复核并设置晚于考试结束时间的截止时间。
- 学生只能为自己的已批改作答申请，且不能直接修改成绩；同一成绩项不能重复创建待处理申请。
- 教师只能处理自己考试的申请，管理员可处理全部申请。
- 接受申请时可选择调整具体单题分数；系统校验不超过题目满分，重算整卷成绩，并刷新课程掌握度。
- 申请、接受和驳回均写入 `grade_audit_logs`，保存操作者、理由和修改前后值。

API：`POST /api/grade-reviews`、`GET /api/grade-reviews/mine`、`GET /api/grade-reviews`、`PATCH /api/grade-reviews/:id/resolve`。

页面：学生 `/student/grade-reviews`；教师 `/teacher/grade-reviews`。学生成绩页在考试开启复核时显示入口。
