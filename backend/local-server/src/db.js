/* ===== ThirdHub 本地后端 — SQLite（按开发文档 schema） ===== */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '新对话',
  model TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT,
  content TEXT,
  reasoning TEXT,
  tool_calls TEXT,
  tool_results TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

-- 记忆指令表
CREATE TABLE IF NOT EXISTS memory_instructions (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- 上下文缓存表（预留）
CREATE TABLE IF NOT EXISTS context_cache (
  id TEXT PRIMARY KEY,
  model TEXT,
  cache_id TEXT,
  hit_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
`);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

module.exports = {
  db, uid,

  /* 会话 */
  listSessions: () => db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all(),
  createSession: (title, model) => {
    const id = uid();
    db.prepare('INSERT INTO sessions (id, title, model) VALUES (?, ?, ?)').run(id, title || '新对话', model || '');
    return { id, title: title || '新对话', model: model || '' };
  },
  deleteSession: (id) => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
  sessionMessages: (id) => db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(id),
  saveMessage: (m) => {
    db.prepare('INSERT INTO messages (id, session_id, role, content, reasoning, tool_calls, tool_results) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), m.session_id || '', m.role, m.content || '', m.reasoning || '', m.tool_calls || '', m.tool_results || '');
    if (m.session_id) db.prepare('UPDATE sessions SET updated_at = strftime(\'%s\',\'now\') WHERE id = ?').run(m.session_id);
  },

  /* 记忆指令 */
  listMemory: () => db.prepare('SELECT * FROM memory_instructions WHERE enabled = 1 ORDER BY created_at ASC').all(),
  addMemory: (content) => {
    const id = uid();
    db.prepare('INSERT INTO memory_instructions (id, content) VALUES (?, ?)').run(id, content);
    return { id, content };
  },
  deleteMemory: (id) => db.prepare('DELETE FROM memory_instructions WHERE id = ?').run(id),
};
