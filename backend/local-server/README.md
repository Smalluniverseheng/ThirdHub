# ThirdHub 本地 AI 后端（自建版）

ThirdHub 网页版的可选本地后端。部署在你自己的设备上（旧手机 Termux / 电脑 / 服务器均可），AI 对话改走局域网，支持流式输出、深度思考展示、会话与记忆本地存储。

> 职责边界：本后端只做对话 / 记忆 / 会话存储。登录、会员、全局设置由 ThirdHub 云端负责。
> 如果你是 ThirdHub 会员，也可以不部署本后端，直接改用云端后端（网页端设置里切换）。

## 一、Termux 部署（旧手机）

```bash
# 1. 安装 Node.js 20+
pkg update && pkg install nodejs-lts

# 2. 获取代码（任选其一）
#    a) 从 ThirdHub 仓库克隆 backend/local-server 目录
#    b) 直接下载网页端安装包里的 local-server 文件夹并上传

# 3. 安装依赖并启动
cd local-server
npm install
npm start
```

启动后终端会显示监听地址（默认 `http://0.0.0.0:3000`）。
查看手机局域网 IP：`ifconfig`（找 wlan0 的 inet 地址，例如 `192.168.1.100`）。

## 二、电脑 / 服务器部署

```bash
cd local-server
npm install
npm start          # 或 npm run pm2（需先 npm i -g pm2，可后台常驻）
```

## 三、连接网页端

ThirdHub 网页 → AI 对话 → 右上设置 → 更多设置 → 提供商与模型管理 → 本地 AI 后端：

- 模式选「本地自建后端」
- 地址填 `http://你的设备IP:3000`
- 点「测试连接」，显示成功后保存

注意：如果网页以 HTTPS 打开，浏览器会拦截到 http:// 局域网地址的请求（混合内容限制）。可用 http:// 方式打开网页端，或给本后端套一层 HTTPS。

## 四、API Key 的两种方式

1. **前端转发（推荐，零配置）**：你在 ThirdHub 网页端已保存的厂商 Key 会随对话请求转发给本后端，后端不保存。
2. **环境变量（可选兜底）**：`DEEPSEEK_API_KEY=sk-xxx npm start`，支持 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`MOONSHOT_API_KEY` 等（变量名 = 厂商 ID 大写 + `_API_KEY`）。

## 五、可选配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `ACCESS_TOKEN` | 空 | 设置后，网页端「访问令牌」需填同样的值，防止同局域网他人滥用 |
| `DB_PATH` | `./data/thirdhub-local.db` | SQLite 数据文件位置 |

## 六、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/api/v1/chat/completions` | 对话（SSE 流式，Wire Protocol） |
| POST | `/api/v1/chat/steer` | 流式中注入消息 |
| GET/POST/DELETE | `/api/v1/chat/sessions*` | 会话管理 |
| GET/POST/DELETE | `/api/v1/memory*` | 记忆指令 |

SSE 事件：`stream_start` / `reasoning_part` / `content_part` / `tool_call` / `steer_ack` / `turn_end` / `error`。
