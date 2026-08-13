# V2 安全专项审计（Phase 11）

## 已检查并加固

- IDOR/tenant leakage：核心详情继续检查所有权，Phase 10 增加显式组织范围与跨组织测试。
- CSRF：API 使用 `Authorization: Bearer`，不使用自动附带的认证 Cookie；CORS 固定开发前端来源。若以后改 Cookie，必须加 SameSite 与 CSRF token。
- SQL injection：业务查询使用 Drizzle 参数绑定；搜索只把输入作为参数，不拼接 SQL。迁移内 SQL 只使用代码内固定表名。
- file upload/path traversal：上传前先验证项目所有权；文件名消毒；限制 20 个/单个 50MB；扩展名之外再检查 PDF、DOC/DOCX 文件签名或文本 NUL；无效新文件安全删除。
- answer/rubric leakage：考试作答 API 使用无答案快照；学生成绩只按考试开关返回答案/解析；练习在整组完成前不返回答案。
- mass assignment/unsafe update：写接口均使用 strict Zod schema；成绩只能由教师批改或审计化复核变更。
- XSS/rendering：客户端未发现 `dangerouslySetInnerHTML`；题干、Markdown/LaTeX 当前以 React 文本节点或 `pre` 渲染。未来引入 HTML/Markdown renderer 必须先净化并禁用原始 HTML。
- Prompt injection：上传材料在分阶段 Prompt 中标为 `untrusted_data`；材料不作为 system 指令。
- 暴力/资源消耗：登录、AI 生成、AI 批改、上传和导出使用分级限流；正常答案自动保存不受该限流器限制。
- 错误跟踪：所有错误响应和响应头包含 `request_id`；前端统一附加“错误编号”。

## 仍需生产部署确认

- 当前限流为单进程内存实现。多实例部署必须替换为 Redis 等共享存储。
- 生产 CORS 来源、JWT secret、TLS、反向代理真实 IP 信任规则需要部署配置审计。
- 杀毒/内容拆弹未实现；高风险学校环境应在对象存储入库前接入恶意文件扫描。
- 自动数据删除未启用，等待业务确认 `docs/data-retention-policy.md`。
