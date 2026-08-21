/* ===== ThirdHub 本地后端 — /api/v1/chat/* 对话路由（文档 Wire Protocol） ===== */
const upstream = require('../llm/upstream');
const store = require('../db');

/* 进行中的流（供 steer 注入） */
const activeStreams = new Map();

module.exports = async function (fastify) {
  /* POST /api/v1/chat/completions — SSE 流式对话 */
  fastify.post('/completions', async (request, reply) => {
    const body = request.body || {};
    const { model, messages = [], provider, session_id } = body;
    if (!model) return reply.code(400).send({ error: '缺少 model' });
    if (!Array.isArray(messages) || !messages.length) return reply.code(400).send({ error: '缺少 messages' });

    // 记忆注入：本地记忆指令拼入 system
    const memories = store.listMemory();
    let finalMessages = messages;
    if (memories.length) {
      const memText = '【长期记忆】\n' + memories.map((m) => '- ' + m.content).join('\n');
      const sysIdx = messages.findIndex((m) => m.role === 'system');
      if (sysIdx >= 0) {
        finalMessages = messages.map((m, i) => i === sysIdx ? { ...m, content: m.content + '\n\n' + memText } : m);
      } else {
        finalMessages = [{ role: 'system', content: memText }, ...messages];
      }
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const streamId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const steerQueue = [];
    activeStreams.set(streamId, { steerQueue });

    const write = (ev, data) => reply.raw.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    write('stream_start', { streamId });

    let reasoningText = '';
    let contentText = '';
    let toolCalls = [];
    let usage = null;

    try {
      const stream = upstream.chat({ ...body, messages: finalMessages });
      for await (const chunk of stream) {
        // steer：流式过程中注入的用户消息，追加进上下文（下一轮生效）
        while (steerQueue.length) {
          const steerMsg = steerQueue.shift();
          finalMessages.push({ role: 'user', content: steerMsg });
          write('steer_ack', { content: steerMsg });
        }

        if (chunk.reasoning_content) {
          reasoningText += chunk.reasoning_content;
          write('reasoning_part', { content: chunk.reasoning_content });
        }
        if (chunk.content) {
          contentText += chunk.content;
          write('content_part', { content: chunk.content });
        }
        if (chunk.tool_calls) {
          toolCalls = chunk.tool_calls;
          for (const tc of chunk.tool_calls) write('tool_call', tc);
        }
        if (chunk.usage) usage = chunk.usage;
      }
      write('turn_end', usage ? { usage } : {});
    } catch (e) {
      write('error', { message: e.message || '上游调用失败' });
    } finally {
      activeStreams.delete(streamId);
      reply.raw.end();
    }

    // 落库：用户最后一条 + 助手回复
    try {
      if (session_id) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUser) store.saveMessage({ session_id, role: 'user', content: lastUser.content || '' });
        store.saveMessage({
          session_id, role: 'assistant', content: contentText, reasoning: reasoningText,
          tool_calls: JSON.stringify(toolCalls),
        });
      }
    } catch (e) { request.log.warn('消息落库失败: ' + e.message); }
  });

  /* POST /api/v1/chat/steer — 流式过程中注入消息 */
  fastify.post('/steer', async (request, reply) => {
    const { streamId, message } = request.body || {};
    const stream = activeStreams.get(streamId);
    if (!stream) return reply.code(404).send({ error: 'Stream not found' });
    stream.steerQueue.push(String(message || ''));
    return { success: true };
  });

  /* 会话 CRUD */
  fastify.get('/sessions', async () => store.listSessions());
  fastify.post('/sessions', async (request) => {
    const { title, model } = request.body || {};
    return store.createSession(title, model);
  });
  fastify.delete('/sessions/:id', async (request) => {
    store.deleteSession(request.params.id);
    return { ok: true };
  });
  fastify.get('/sessions/:id/messages', async (request) => store.sessionMessages(request.params.id));
};
