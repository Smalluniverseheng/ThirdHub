/* ===== ThirdHub js/ai/ai-models.js — 厂商与模型清单（270+ 模型，按厂商分组） =====
   type: chat（对话）/ image（绘画）/ embed（嵌入）
   所有厂商默认走 OpenAI 兼容 /v1/chat/completions 或各自适配器 */

export const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', type: 'openai', models: [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o4-mini', 'o3-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o1',
  ], image: ['dall-e-3', 'gpt-image-1'] },
  { id: 'anthropic', name: 'Anthropic', base: 'https://api.anthropic.com/v1', type: 'anthropic', models: [
    'claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4', 'claude-sonnet-4', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest',
  ] },
  { id: 'google', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', type: 'openai', models: [
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash',
  ] },
  { id: 'xai', name: 'xAI', base: 'https://api.x.ai/v1', type: 'openai', models: [
    'grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini', 'grok-2-vision-1212',
  ] },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', type: 'openai', models: [
    'deepseek-chat', 'deepseek-reasoner',
  ] },
  { id: 'aliyun', name: '阿里云 · 通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', type: 'openai', models: [
    'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen3-235b-a22b', 'qwen3-32b', 'qwen3-14b', 'qwen3-8b', 'qwen2.5-72b-instruct', 'qwen2.5-32b-instruct', 'qwen2.5-14b-instruct', 'qwen2.5-7b-instruct', 'qwen-vl-max', 'qwen-vl-plus', 'qwq-32b',
  ], image: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus'] },
  { id: 'tencent', name: '腾讯云 · 混元', base: 'https://api.hunyuan.cloud.tencent.com/v1', type: 'openai', models: [
    'hunyuan-turbos-latest', 'hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite', 'hunyuan-vision',
  ] },
  { id: 'baidu', name: '百度 · 文心一言', base: 'https://qianfan.baidubce.com/v2', type: 'openai', models: [
    'ernie-4.5-turbo-128k', 'ernie-4.5-8k-preview', 'ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed-8k', 'ernie-lite-8k', 'ernie-x1-turbo-32k',
  ] },
  { id: 'bytedance', name: '字节跳动 · 豆包', base: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai', models: [
    'doubao-1.5-pro-32k', 'doubao-1.5-pro-256k', 'doubao-1.5-lite-32k', 'doubao-pro-32k', 'doubao-lite-32k', 'doubao-vision-pro-32k', 'deepseek-r1-250528', 'deepseek-v3-250324',
  ], image: ['doubao-seedream-3-0-t2i'] },
  { id: 'moonshot', name: '月之暗面 · Kimi', base: 'https://api.moonshot.cn/v1', type: 'openai', models: [
    'kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'moonshot-v1-auto', 'kimi-latest', 'kimi-thinking-preview',
  ] },
  { id: 'zhipu', name: '智谱 AI', base: 'https://open.bigmodel.cn/api/paas/v4', type: 'openai', models: [
    'glm-4.5', 'glm-4.5-air', 'glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus', 'glm-z1-air', 'glm-4-long',
  ], image: ['cogview-3-plus'] },
  { id: 'yi', name: '零一万物', base: 'https://api.lingyiwanwu.com/v1', type: 'openai', models: [
    'yi-lightning', 'yi-large', 'yi-medium', 'yi-vision', 'yi-spark',
  ] },
  { id: 'sensechat', name: '商汤 · 商量', base: 'https://api.sensenova.cn/v1', type: 'openai', models: [
    'SenseChat-5', 'SenseChat-5-128K', 'SenseChat-Turbo',
  ] },
  { id: 'minimax', name: 'MiniMax', base: 'https://api.minimax.chat/v1', type: 'openai', models: [
    'MiniMax-M1', 'abab6.5s-chat', 'abab6.5-chat', 'abab5.5-chat',
  ] },
  { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', type: 'openai', models: [
    'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-32B-Instruct', 'Qwen/Qwen2.5-14B-Instruct', 'Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat', 'meta-llama/Meta-Llama-3.1-70B-Instruct', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'internlm/internlm2_5-20b-chat', 'Qwen/QwQ-32B',
  ], image: ['Kwai-Kolors/Kolors', 'stabilityai/stable-diffusion-3-5-large'] },
  { id: 'baichuan', name: '百川智能', base: 'https://api.baichuan-ai.com/v1', type: 'openai', models: [
    'Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k', 'Baichuan2-Turbo',
  ] },
  { id: 'stepfun', name: '阶跃星辰', base: 'https://api.stepfun.com/v1', type: 'openai', models: [
    'step-2-16k', 'step-1-8k', 'step-1-32k', 'step-1-128k', 'step-1v-8k', 'step-1.5v-mini',
  ] },
  { id: 'spark', name: '讯飞星火', base: 'https://spark-api-open.xf-yun.com/v1', type: 'openai', models: [
    'generalv3.5', 'generalv3', '4.0Ultra', 'max-32k', 'lite',
  ] },
  { id: 'tiangong', name: '天工 AI', base: 'https://sky-api.singularity-ai.com/saas/api/v1', type: 'openai', models: [
    'sky-chat', 'Skywork-o1-Open',
  ] },
  { id: 'qihoo', name: '360 智脑', base: 'https://api.360.cn/v1', type: 'openai', models: [
    '360gpt-pro', '360gpt-turbo', '360gpt2-pro',
  ] },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', type: 'openai', models: [
    'mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'pixtral-large-latest', 'ministral-8b-latest', 'open-mistral-nemo',
  ] },
  { id: 'cohere', name: 'Cohere', base: 'https://api.cohere.com/compatibility/v1', type: 'openai', models: [
    'command-r-plus', 'command-r', 'command', 'command-light',
  ] },
  { id: 'perplexity', name: 'Perplexity', base: 'https://api.perplexity.ai', type: 'openai', models: [
    'sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro',
  ] },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', type: 'openai', models: [
    'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'deepseek-r1-distill-llama-70b',
  ] },
  { id: 'together', name: 'Together AI', base: 'https://api.together.xyz/v1', type: 'openai', models: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'mistralai/Mixtral-8x22B-Instruct-v0.1',
  ] },
  { id: 'fireworks', name: 'Fireworks', base: 'https://api.fireworks.ai/inference/v1', type: 'openai', models: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/llama-v3p1-405b-instruct', 'accounts/fireworks/models/deepseek-v3', 'accounts/fireworks/models/deepseek-r1', 'accounts/fireworks/models/qwen2p5-72b-instruct',
  ] },
  { id: 'replicate', name: 'Replicate', base: '', type: 'openai', models: [] },
  { id: 'stability', name: 'Stability AI', base: '', type: 'openai', models: [], image: ['stable-diffusion-3-5-large', 'stable-image-ultra'] },
  { id: 'midjourney', name: 'Midjourney（第三方接入）', base: '', type: 'openai', models: [], image: ['midjourney-v6'] },
  { id: 'openrouter', name: 'OpenRouter（聚合）', base: 'https://openrouter.ai/api/v1', type: 'openai', models: [
    'openai/gpt-4o', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat', 'deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct', 'x-ai/grok-3', 'mistralai/mistral-large',
  ] },
  { id: 'azure', name: 'Azure OpenAI', base: '', type: 'openai', models: [] },
  { id: 'nvidia', name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', type: 'openai', models: [
    'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-72b-instruct', 'mistralai/mistral-large-2-instruct',
  ] },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', base: '', type: 'openai', models: [] },
  { id: 'custom', name: '自定义提供商', base: '', type: 'openai', models: [] },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

/* 统计模型总数 */
export function totalModelCount() {
  return PROVIDERS.reduce((n, p) => n + (p.models ? p.models.length : 0) + (p.image ? p.image.length : 0), 0);
}
