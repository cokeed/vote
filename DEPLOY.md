# 部署指南

## 环境要求
- Node.js 18+
- 无需外部数据库，内置 SQLite（文件位于 data/voting.db）

## 安装与启动
1. 安装依赖
   ```bash
   npm install
   ```
2. 设置环境变量（生产环境务必修改密钥）
   - `PORT` 服务端口，默认 3000
   - `JWT_SECRET` JWT 密钥，默认 dev-secret-change-me
   - `IP_HASH_SECRET` IP 哈希密钥，默认 ip-secret
3. 启动服务
   ```bash
   npm start
   ```
4. 访问
   - 前端首页：http://localhost:3000/
   - 管理后台：http://localhost:3000/admin.html
   - API 文档：http://localhost:3000/api-docs

## 管理员账号
- 首次启动自动创建默认管理员：用户名 `admin`，密码 `admin123`
- 登录后台后请尽快修改密码（后续可扩展用户资料编辑接口）

## 安全加固建议
- 在反向代理层增加 IP 限流与真实 IP 透传（X-Forwarded-For）
- 配置 HTTPS
- 将 `JWT_SECRET` 与 `IP_HASH_SECRET` 设置为足够复杂的随机值
- 考虑接入专业验证码服务（如 reCAPTCHA）或引入图形验证码

## 横向扩展与实时结果
- 当前实时结果使用 SSE（单实例内存维护连接），足以支持 1000 在线
- 若需多实例部署，建议：
  - 使用 Redis 发布/订阅广播投票事件
  - 通过反向代理实现粘性会话，或升级为 WebSocket + 共享消息总线

## 压力测试（示例）
使用 k6 进行并发压测（需自备 k6）

1. 安装 k6：https://k6.io/
2. 编辑 `loadtest/k6.js` 中投票 ID 与 payload
3. 运行：
   ```bash
   k6 run loadtest/k6.js
   ```
4. 目标：在 1000 并发下投票接口保持较低错误率与可接受的响应时间

## 数据备份
- 仅需备份 `data/voting.db` 文件
- 支持热备（WAL 模式）

## 常见问题
- 无法访问 API 文档：确认 `docs/swagger.json` 文件存在且权限正常
- 登录失败：确认时间同步与 JWT_SECRET 未频繁变更
- 投票提示已投：系统对同一用户或同一 IP（匿名）限制一票

