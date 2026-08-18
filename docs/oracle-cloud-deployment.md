# Oracle Cloud 单机部署指南

本文档用于把 Exam Maker 部署到一台 Oracle Cloud Infrastructure（OCI）Ubuntu ARM 虚机。该方案面向个人体验、演示和小规模教师试用，不是多实例高可用架构。

## 1. 部署边界

部署拓扑：

```text
Browser --HTTPS--> Nginx :443
                       |-- /      --> client/dist
                       `-- /api   --> Node.js :3001 (仅监听 127.0.0.1)
                                         |-- server/data/exam-maker.db
                                         |-- server/data/projects
                                         |-- server/data/exports
                                         `-- DeepSeek API
```

当前数据库由 `sql.js` 整体加载到内存并周期性落盘，因此必须遵守：

- 只运行一个 `exam-maker.service` 后端进程。
- 不使用 PM2 cluster、Node cluster 或多个容器副本。
- 每次部署前备份，定期把本机备份复制到 OCI Object Storage 或其他独立存储。
- 正式考试或多教师高并发使用前，应先迁移到服务器数据库和独立对象存储。

## 2. 推荐虚机

- Shape：`VM.Standard.A1.Flex`。
- CPU：2 OCPU。
- 内存：建议 8–12 GB；最低 4 GB 并增加 4 GB swap。
- Boot Volume：80–100 GB。
- Image：Ubuntu 24.04（ARM/aarch64，非 Minimal）。
- 公网：分配公共 IPv4。

创建 OCI 账户时应谨慎选择 Home Region，免费计算资源受 Home Region 和实时容量约束。

OCI Security List 或 Network Security Group 只开放：

| 端口 | 来源 | 用途 |
|---|---|---|
| 22/TCP | 管理员固定 IP | SSH |
| 80/TCP | `0.0.0.0/0`、`::/0` | HTTP 和证书签发 |
| 443/TCP | `0.0.0.0/0`、`::/0` | HTTPS |

不要开放 3001 和 5173。

## 3. 连接并安装宿主机依赖

在本机保存 OCI 私钥后连接：

```bash
ssh -i /path/to/oci-private-key ubuntu@PUBLIC_IP
```

先把仓库克隆到临时目录，以取得安装脚本：

```bash
git clone https://github.com/ganmingzhang68-glitch/exam-maker.git /tmp/exam-maker-bootstrap
sudo /tmp/exam-maker-bootstrap/deploy/oracle/setup-host.sh
```

脚本仅支持 Ubuntu，安装：

- Node.js 22、Nginx、Certbot；
- Pandoc、LibreOffice；
- XeLaTeX、中文字体和 LaTeX 扩展；
- Python、NumPy、SymPy；
- Git、rsync、SQLite、备份工具。

安装完成后，将正式仓库克隆为专用系统用户所有：

```bash
sudo -u exam-maker -H git clone https://github.com/ganmingzhang68-glitch/exam-maker.git /opt/exam-maker
rm -rf /tmp/exam-maker-bootstrap
```

如果 `/opt/exam-maker` 已包含文件，先确认内容，不要直接删除。私有仓库应使用只读 Deploy Key，不要在服务器保存个人 GitHub 密码。

低于 8 GB 内存时增加 swap：

```bash
sudo /opt/exam-maker/deploy/oracle/ensure-swap.sh 4
free -h
```

## 4. 配置生产环境变量

```bash
sudo -u exam-maker cp /opt/exam-maker/deploy/oracle/env.production.example /opt/exam-maker/.env
sudo chmod 600 /opt/exam-maker/.env
openssl rand -base64 48
sudoedit /opt/exam-maker/.env
```

至少修改：

- `CORS_ORIGIN`：最终访问地址，例如 `https://exam.example.com`；首次用 IP 测试可填 `http://PUBLIC_IP`。
- `JWT_SECRET`：使用上述 `openssl` 命令生成的随机值，至少 32 个字符。
- `AI_API_KEY`：新建的 DeepSeek API Key。
- `AI_MODEL`：账户实际可用模型。

生产 `.env` 位于服务器 `/opt/exam-maker/.env`，已被 Git 忽略。不得把密钥写入 GitHub、部署脚本、systemd unit、命令历史或截图。

## 5. 安装并启动服务

使用域名：

```bash
sudo DOMAIN=exam.example.com /opt/exam-maker/deploy/oracle/install-service.sh
```

暂时使用公网 IP：

```bash
sudo DOMAIN=PUBLIC_IP /opt/exam-maker/deploy/oracle/install-service.sh
```

安装脚本会执行：

1. `npm ci`；
2. 前端、共享包和后端生产构建；
3. 内存、密钥和外部工具预检；
4. 安装并启用 Nginx、API systemd 服务；
5. 启用每日 03:30 数据备份 timer；
6. 调用 `/api/health` 验证后端启动。

检查状态：

```bash
sudo systemctl status exam-maker --no-pager
sudo systemctl status exam-maker-backup.timer --no-pager
sudo journalctl -u exam-maker -n 100 --no-pager
curl -fsS http://127.0.0.1:3001/api/health
curl -I http://PUBLIC_IP
```

如果启用了 Ubuntu UFW：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

启用 UFW 前必须先允许 OpenSSH，以免中断远程管理。

## 6. 配置 HTTPS

先将域名 A/AAAA 记录指向虚机公网地址并等待解析生效，然后运行：

```bash
sudo certbot --nginx -d exam.example.com
sudo certbot renew --dry-run
```

HTTPS 生效后，把 `.env` 中 `CORS_ORIGIN` 改为 HTTPS 地址并重启：

```bash
sudo systemctl restart exam-maker
```

不要使用自签名证书对外提供教师登录服务。

## 7. 更新部署

确认 GitHub `main` 是需要发布的版本，然后在服务器运行：

```bash
sudo /opt/exam-maker/deploy/oracle/deploy.sh
```

该脚本使用部署锁并依次执行：

```text
检查已跟踪文件无本地修改
→ 停止服务并创建一致性数据备份
→ git pull --ff-only
→ npm ci
→ npm run build
→ 生产预检
→ 重启后端并 reload Nginx
→ 健康检查
```

脚本不会删除未跟踪文件，也不会强制覆盖服务器改动。发布失败时先查看日志，不要执行 `git reset --hard`。

## 8. 备份和恢复

立即创建备份：

```bash
sudo /opt/exam-maker/deploy/oracle/backup.sh
sudo ls -lh /var/backups/exam-maker
```

备份会短暂停止 API，让 `sql.js` 在 SIGTERM 时先把内存数据完整写回磁盘，再归档 `server/data`。默认保留 14 天，并生成 SHA-256 文件。

本机备份仍与虚机处于同一故障域，必须额外配置以下至少一种：

- OCI Boot/Block Volume 定时备份；
- OCI Object Storage；
- 加密后同步到另一云或本地设备。

恢复前先停止服务并再次保存当前数据：

```bash
sudo systemctl stop exam-maker
cd /var/backups/exam-maker
sha256sum -c exam-maker-TIMESTAMP.tar.gz.sha256
sudo mv /opt/exam-maker/server/data /opt/exam-maker/server/data.before-restore
sudo tar -xzf exam-maker-TIMESTAMP.tar.gz -C /opt/exam-maker
sudo chown -R exam-maker:exam-maker /opt/exam-maker/server/data
sudo systemctl start exam-maker
curl -fsS http://127.0.0.1:3001/api/health
```

恢复操作会替换当前业务数据，必须使用实际文件名并先保留 `data.before-restore`。

## 9. 上线验收

只有实际完成以下步骤后才能确认部署可用：

1. 登录教师账号；
2. 上传一份不含敏感信息的最小 Markdown 真题；
3. 执行 DeepSeek 解析、答案对齐和考点分析；
4. 确认模板和目标细目表；
5. 生成一套新试卷；
6. 查看 ValidationReport；
7. 分别下载学生卷、答案卷和评分标准；
8. 验证 Markdown、LaTeX/PDF 和 DOCX 内容一致且能打开；
9. 检查 DeepSeek 用量记录；
10. 手工执行一次备份并验证校验和。

## 10. 已知限制

- 尚未在真实 OCI ARM 虚机执行本指南，ARM 包安装和完整出题链路仍需实际验证。
- 免费实例可能因区域容量不足无法创建，也可能受空闲实例回收规则影响。
- 当前备份 timer 会产生短暂停机，不适合正式考试进行期间执行。
- 当前单文件内存数据库不适合多实例、高并发和高可用场景。
- DeepSeek API 费用、可用性和数据跨境要求不属于 OCI 免费额度。
