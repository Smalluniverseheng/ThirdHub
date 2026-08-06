/* ===== ThirdHub js/ai/ai-rankings.js — 模型排行榜（静态快照，随版本更新） =====
   数据综合自公开榜单（LMArena / SuperCLUE 等）的约值快照，s = 0-100 综合分。
   分类：综合 / 代码 / 英文 / 困难提示 / 中文 / 多轮对话 / 创意写作 / 数学 / 指令遵循 / 日语 / 韩语 */

export const RANK_CATEGORIES = [
  { id: 'overall', name: '综合榜' },
  { id: 'code', name: '代码榜' },
  { id: 'english', name: '英文榜' },
  { id: 'hard', name: '困难提示' },
  { id: 'chinese', name: '中文榜' },
  { id: 'multi', name: '多轮对话' },
  { id: 'writing', name: '创意写作' },
  { id: 'math', name: '数学榜' },
  { id: 'instruct', name: '指令遵循' },
  { id: 'japanese', name: '日语榜' },
  { id: 'korean', name: '韩语榜' },
];

/* m: 模型名（展示用） p: 厂商 id（取图标） s: 分数 */
export const RANKINGS = {
  overall: [
    { m: 'Gemini 3 Pro', p: 'google', s: 96 }, { m: 'GPT-5', p: 'openai', s: 95 },
    { m: 'Claude Opus 4.1', p: 'anthropic', s: 94 }, { m: 'Grok 4.1', p: 'xai', s: 93 },
    { m: 'Kimi K2 Thinking', p: 'moonshot', s: 92 }, { m: 'DeepSeek V3.2', p: 'deepseek', s: 91 },
    { m: 'Qwen3 Max', p: 'aliyun', s: 90 }, { m: 'GLM-4.6', p: 'zhipu', s: 89 },
    { m: 'MiniMax M2', p: 'minimax', s: 88 }, { m: '豆包 Seed 1.6', p: 'bytedance', s: 87 },
    { m: 'MiMo v2.5 Pro', p: 'xiaomi', s: 86 }, { m: '混元 T1', p: 'tencent', s: 85 },
  ],
  code: [
    { m: 'Claude Opus 4.1', p: 'anthropic', s: 95 }, { m: 'GPT-5', p: 'openai', s: 94 },
    { m: 'Gemini 3 Pro', p: 'google', s: 93 }, { m: 'Qwen3 Coder Plus', p: 'aliyun', s: 91 },
    { m: 'DeepSeek V3.2', p: 'deepseek', s: 90 }, { m: 'Kimi K2 Thinking', p: 'moonshot', s: 89 },
    { m: 'GLM-4.6', p: 'zhipu', s: 88 }, { m: 'MiniMax M2', p: 'minimax', s: 87 },
    { m: 'Grok 4.1', p: 'xai', s: 86 }, { m: 'Codestral', p: 'mistral', s: 83 },
  ],
  english: [
    { m: 'GPT-5', p: 'openai', s: 96 }, { m: 'Claude Opus 4.1', p: 'anthropic', s: 95 },
    { m: 'Gemini 3 Pro', p: 'google', s: 94 }, { m: 'Grok 4.1', p: 'xai', s: 92 },
    { m: 'Llama 3.3 70B', p: 'groq', s: 87 }, { m: 'Mistral Large', p: 'mistral', s: 86 },
    { m: 'Command R+', p: 'cohere', s: 84 }, { m: 'DeepSeek V3.2', p: 'deepseek', s: 84 },
    { m: 'Qwen3 Max', p: 'aliyun', s: 83 }, { m: 'Kimi K2', p: 'moonshot', s: 82 },
  ],
  hard: [
    { m: 'Gemini 3 Pro', p: 'google', s: 95 }, { m: 'GPT-5', p: 'openai', s: 94 },
    { m: 'Claude Opus 4.1', p: 'anthropic', s: 93 }, { m: 'Grok 4.1', p: 'xai', s: 91 },
    { m: 'Kimi K2 Thinking', p: 'moonshot', s: 90 }, { m: 'DeepSeek R1', p: 'deepseek', s: 89 },
    { m: 'Qwen3 Max', p: 'aliyun', s: 87 }, { m: 'GLM-4.6', p: 'zhipu', s: 86 },
    { m: '混元 T1', p: 'tencent', s: 84 }, { m: 'MiMo v2.5 Pro', p: 'xiaomi', s: 83 },
  ],
  chinese: [
    { m: 'DeepSeek V3.2', p: 'deepseek', s: 94 }, { m: 'Qwen3 Max', p: 'aliyun', s: 93 },
    { m: 'Kimi K2 Thinking', p: 'moonshot', s: 92 }, { m: 'GLM-4.6', p: 'zhipu', s: 91 },
    { m: '豆包 Seed 1.6', p: 'bytedance', s: 90 }, { m: '混元 T1', p: 'tencent', s: 88 },
    { m: '文心 4.5 Turbo', p: 'baidu', s: 87 }, { m: 'MiMo v2.5 Pro', p: 'xiaomi', s: 86 },
    { m: 'MiniMax M2', p: 'minimax', s: 85 }, { m: '讯飞星火 4.0', p: 'spark', s: 84 },
  ],
  multi: [
    { m: 'GPT-5', p: 'openai', s: 94 }, { m: 'Claude Sonnet 4.5', p: 'anthropic', s: 93 },
    { m: 'Gemini 3 Pro', p: 'google', s: 92 }, { m: 'Kimi K2', p: 'moonshot', s: 91 },
    { m: 'DeepSeek V3.2', p: 'deepseek', s: 89 }, { m: 'Qwen3 Max', p: 'aliyun', s: 88 },
    { m: 'Grok 4.1', p: 'xai', s: 87 }, { m: 'GLM-4.6', p: 'zhipu', s: 86 },
    { m: '豆包 Seed 1.6', p: 'bytedance', s: 85 }, { m: 'MiniMax M2', p: 'minimax', s: 84 },
  ],
  writing: [
    { m: 'Claude Opus 4.1', p: 'anthropic', s: 95 }, { m: 'GPT-5', p: 'openai', s: 92 },
    { m: 'Kimi K2', p: 'moonshot', s: 91 }, { m: 'Gemini 3 Pro', p: 'google', s: 90 },
    { m: 'DeepSeek V3.2', p: 'deepseek', s: 89 }, { m: 'GLM-4.6', p: 'zhipu', s: 87 },
    { m: 'Grok 4.1', p: 'xai', s: 86 }, { m: 'Qwen3 Max', p: 'aliyun', s: 85 },
    { m: '文心 4.5 Turbo', p: 'baidu', s: 84 }, { m: 'Mistral Large', p: 'mistral', s: 82 },
  ],
  math: [
    { m: 'Gemini 3 Pro', p: 'google', s: 96 }, { m: 'GPT-5', p: 'openai', s: 95 },
    { m: 'DeepSeek R1', p: 'deepseek', s: 93 }, { m: 'Claude Opus 4.1', p: 'anthropic', s: 92 },
    { m: 'Grok 4.1', p: 'xai', s: 91 }, { m: 'Kimi K2 Thinking', p: 'moonshot', s: 90 },
    { m: 'Qwen3 Max', p: 'aliyun', s: 89 }, { m: 'MiMo v2.5 Pro', p: 'xiaomi', s: 87 },
    { m: 'GLM-4.6', p: 'zhipu', s: 86 }, { m: '混元 T1', p: 'tencent', s: 84 },
  ],
  instruct: [
    { m: 'GPT-5', p: 'openai', s: 95 }, { m: 'Claude Sonnet 4.5', p: 'anthropic', s: 94 },
    { m: 'Gemini 3 Pro', p: 'google', s: 93 }, { m: 'Kimi K2', p: 'moonshot', s: 90 },
    { m: 'Qwen3 Max', p: 'aliyun', s: 89 }, { m: 'DeepSeek V3.2', p: 'deepseek', s: 88 },
    { m: 'Grok 4.1', p: 'xai', s: 87 }, { m: 'GLM-4.6', p: 'zhipu', s: 86 },
    { m: '豆包 Seed 1.6', p: 'bytedance', s: 85 }, { m: 'MiniMax M2', p: 'minimax', s: 84 },
  ],
  japanese: [
    { m: 'GPT-5', p: 'openai', s: 93 }, { m: 'Claude Opus 4.1', p: 'anthropic', s: 92 },
    { m: 'Gemini 3 Pro', p: 'google', s: 91 }, { m: 'Grok 4.1', p: 'xai', s: 88 },
    { m: 'DeepSeek V3.2', p: 'deepseek', s: 85 }, { m: 'Qwen3 Max', p: 'aliyun', s: 84 },
    { m: 'Kimi K2', p: 'moonshot', s: 83 }, { m: 'GLM-4.6', p: 'zhipu', s: 81 },
    { m: 'Mistral Large', p: 'mistral', s: 79 }, { m: 'MiniMax M2', p: 'minimax', s: 78 },
  ],
  korean: [
    { m: 'GPT-5', p: 'openai', s: 92 }, { m: 'Claude Opus 4.1', p: 'anthropic', s: 91 },
    { m: 'Gemini 3 Pro', p: 'google', s: 90 }, { m: 'Grok 4.1', p: 'xai', s: 87 },
    { m: 'DeepSeek V3.2', p: 'deepseek', s: 84 }, { m: 'Qwen3 Max', p: 'aliyun', s: 83 },
    { m: 'Kimi K2', p: 'moonshot', s: 82 }, { m: 'GLM-4.6', p: 'zhipu', s: 80 },
    { m: 'MiniMax M2', p: 'minimax', s: 77 }, { m: 'Mistral Large', p: 'mistral', s: 76 },
  ],
};
