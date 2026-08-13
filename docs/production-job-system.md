# Production Job System

V2 Phase 1 在已有 `generation_jobs` / `generation_job_stages` 和 `similar_question_jobs` / `similar_question_job_stages` 上统一任务视图，没有另建第三套执行引擎。

## 状态与进度

统一状态为 `queued`、`running`、`retrying`、`succeeded`、`failed`、`cancelled`、`blocked`。旧表的 `status` 为兼容字段，新字段 `task_status` 是任务中心状态。

进度只显示“已成功的不同阶段数 / 该任务定义的阶段总数”。页面上的进度条仅是这一分数的可视化，不表示模型内部百分比。

旧项目出卷工作流当前按它实际可观测的 6 个阶段展示；结构化新管线仍按 14 阶段展示。系统不会用 14 个名称包装只有 6 个真实边界的旧流程。

## 控制语义

- 幂等：相似题创建接受 `Idempotency-Key`；同一用户和键返回已有任务。
- 取消：在阶段边界检查取消状态。正在进行的外部 AI HTTP 调用不会被伪称为已强制终止；它返回后不再开始下一阶段。
- 重试：继续复用已成功阶段输出，失败/取消任务从第一个未成功阶段恢复。
- 恢复：相似题服务启动时修复遗留的 running stage 并恢复未取消任务。
- 隔离：教师只能访问自己创建的任务，admin 可查看全部任务。

## API

- `GET /api/tasks`
- `GET /api/tasks/:kind/:id`
- `POST /api/tasks/:kind/:id/cancel`
- `POST /api/tasks/:kind/:id/retry`

`kind` 为 `generation` 或 `similar_question`。

## 可观测性

所有 API 响应头包含 `X-Request-Id`。错误 JSON 同时包含 `requestId`，服务端错误日志使用相同编号。任务详情聚合模型、输入/输出 token、阶段 attempt number 和阶段耗时。

成本目前返回 `null` 并明确显示“未配置版本化模型价格”。在 `AiCostConfig` 和有效期价格完成前不猜测费用。
