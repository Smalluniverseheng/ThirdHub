/* ===== ThirdHub 本地后端 — 入口 =====
   职责边界（按开发文档）：只做对话 / 工具 / 记忆 / 会话存储，
   不做认证、会员、全局设置 —— 那些由 ThirdHub 云端负责。 */
const Fastify = require('fastify');
const { PORT, HOST, ACCESS_TOKEN, VERSION } = require('./config');

const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });

/* CORS：PWA 从浏览器跨域访问局域网后端 */
app.addHook('onRequest', async (request, reply) => {
  reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (request.method === 'OPTIONS') {
    reply.code(204).send();
    return reply;
  }
});

/* 可选访问令牌（设置 ACCESS_TOKEN 环境变量后启用） */
app.addHook('onRequest', async (request, reply) => {
  if (!ACCESS_TOKEN) return;
  if (request.method === 'OPTIONS') return;
  const auth = request.headers.authorization || '';
  if (auth !== 'Bearer ' + ACCESS_TOKEN) {
    return reply.code(401).send({ error: '访问令牌不正确' });
  }
});

/* 健康检查（/health 为文档约定；/api/v1/health 与云端路径对齐） */
const health = async () => ({
  ok: true,
  name: 'thirdhub-local',
  mode: 'local',
  version: VERSION,
  time: Date.now(),
});
app.get('/health', health);
app.get('/api/v1/health', health);

/* 业务路由 */
app.register(require('./routes/chat'), { prefix: '/api/v1/chat' });
app.register(require('./routes/memory'), { prefix: '/api/v1/memory' });

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`ThirdHub 本地后端 v${VERSION} 已启动: ${address}`);
  console.log('在 ThirdHub 网页端「AI 设置 → 提供商与模型管理 → 本地 AI 后端」中填入此地址即可使用');
});
