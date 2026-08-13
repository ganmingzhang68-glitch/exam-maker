# 管理员后台（Phase 9）

管理员控制台 `/admin` 提供系统汇总、用户管理、AI 资源使用、版本化成本配置和系统审计日志。管理员还可通过现有 `/teacher/tasks` 查看全局任务、通过 `/courses` 查看全部课程。

用户支持搜索、创建、禁用、恢复和重置登录状态。JWT 包含 `token_version`，禁用或重置后旧 token 立即失效。管理员不能禁用自己或移除自己的管理员角色。API 只返回用户公开字段，明确排除密码、密码 hash、token 和 token version。

AI 使用统计包含调用数、输入/输出 token、失败率、平均延迟，并按模型、课程与 stage（功能）分组。`ai_cost_configs` 按 provider、model、effective_from 版本化；仅在价格覆盖调用时间时显示 `estimated cost`，它不是财务账单。

管理员默认不读取或展示学生具体答案。用户和成本配置变更写入 `system_audit_logs`，包含 `request_id`。
