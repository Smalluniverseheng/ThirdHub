/* ===== ThirdHub 本地后端 — /api/v1/memory 记忆指令 ===== */
const store = require('../db');

module.exports = async function (fastify) {
  fastify.get('/', async () => store.listMemory());
  fastify.post('/', async (request, reply) => {
    const { content } = request.body || {};
    if (!content || !String(content).trim()) return reply.code(400).send({ error: '缺少 content' });
    return store.addMemory(String(content).trim());
  });
  fastify.delete('/:id', async (request) => {
    store.deleteMemory(request.params.id);
    return { ok: true };
  });
};
