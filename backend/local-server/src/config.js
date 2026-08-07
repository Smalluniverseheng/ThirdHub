/* ===== ThirdHub 本地后端 — 配置 ===== */
const path = require('path');

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'thirdhub-local.db'),
  // 可选：访问令牌。设置后前端必须在「本地 AI 后端 → 访问令牌」中填入同样的值
  ACCESS_TOKEN: process.env.ACCESS_TOKEN || '',
  VERSION: '0.1.0',
};
