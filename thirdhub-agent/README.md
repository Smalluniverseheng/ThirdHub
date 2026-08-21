# ThirdHub-Agent（本地算力后端，v0.1）

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本地 AI 算力服务：
ThirdHub 前端（PWA）通过 WebSocket 连接本服务，即可在浏览器之外使用完整 Agent 能力
（本地工具、文件读写、代码执行、MCP 服务）。

## 部署（用户侧）

要求：Node.js 18+

```bash
npm install --legacy-peer-deps   # 依赖包含 rc 版本，需 legacy-peer-deps
npm start
```

首次启动会要求**设置访问密码**（保护 API Key 与算力，前端连接需验证）。
启动后显示：`WS 服务已启动：ws://<IP>:9600`

## 在 ThirdHub 中使用

1. ThirdHub → 算力 → ＋添加设备 → 填 `IP:9600` + 访问密码
2. 连接成功后，AI 对话页输入框上方切换「本地模式 · 设备名」
3. 发送消息即由本机 DSH 内核处理（模型 / 工具 / MCP），流式返回

## 配置模型（前端下发）

- 算力设备详情 → 模型配置：添加模型（名称 / Base URL / API Key / 模型 ID）
- API Key 以 AES-256-GCM 加密存储于 `data/config.json`（主密钥 `data/master.key`）
- 配置变更后内核自动重启生效

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.js` | WS 服务：认证 / 对话 / 配置管理 / 历史 |
| `agent-bin.mjs` | DSH 内核子进程入口（stdio JSON-RPC） |
| `cordis.yml` | DSH 内核组合配置（headless + jsonrpc-server） |
| `data/` | 运行时数据（config.json / master.key / sessions.jsonl），自动生成 |

## 协议

见 index.js 头部注释（auth / chat / stream_token / stream_done / config / history / heartbeat）。

## License

MIT
