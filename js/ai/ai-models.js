import { kvGet } from '../store.js';
import { setCustomVendorIcon, clearCustomVendorIcons } from './vendors.js';

/* ===== ThirdHub js/ai/ai-models.js — 厂商与模型清单（v1.5 · 33 家厂商 300+ 模型） =====
   type: openai（OpenAI 兼容）/ anthropic（Claude 适配器）
   models: 对话模型 · image: 绘画模型 · video: 视频模型 · deprecated: 历史模型（默认折叠）
   所有厂商默认走 OpenAI 兼容 /v1/chat/completions 或各自适配器 */

export const PROVIDERS = [
  { id: 'opencode-zen', name: 'OpenCode Zen', base: 'https://opencode.ai/zen/v1', type: 'openai', desc: '部分模型限时免费', models: [
    { id: 'x-preview-f-free', name: 'Ox Alpha Free', tags: ['free', '1M-context', 'reasoning', 'vision', 'recommended'], recommended: true, privacyLevel: 'safe', privacyNote: '零数据保留，不用于模型训练；100万上下文' },
    { id: 'big-pickle', name: 'Big Pickle', tags: ['free'], privacyLevel: 'caution', privacyNote: '免费期间数据可能用于改进模型' },
    { id: 'mimo-v2.5-free', name: 'MiMo V2.5 Free', tags: ['free'], privacyLevel: 'caution', privacyNote: '免费期间数据可能用于改进模型' },
    { id: 'hy3-free', name: 'Hy3 Free', tags: ['free'], privacyLevel: 'caution', privacyNote: '免费期间数据可能用于改进模型' },
    { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free', tags: ['free'], privacyLevel: 'unknown' },
    { id: 'laguna-s-2.1-free', name: 'Laguna S 2.1 Free', tags: ['free'], privacyLevel: 'unknown' },
    { id: 'nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free', tags: ['free', 'privacy-risk'], privacyLevel: 'risk', privacyNote: 'NVIDIA 记录使用数据，勿传机密信息' },
    { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free', tags: ['free', 'privacy-risk'], privacyLevel: 'risk', privacyNote: 'NVIDIA 记录使用数据，勿传机密信息' },
    { id: 'muse-spark-1.2-contributor-free', name: 'Muse Spark 1.2 Contributor Free', tags: ['free', 'privacy-risk'], privacyLevel: 'risk', privacyNote: '数据可能用于训练 Meta 未来模型；端点 /responses 可能不兼容' },
  ] },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', type: 'openai', models: [
    'gpt-5.2', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o4-mini',
  ], image: ['gpt-image-1', 'dall-e-3'], video: ['sora-2', 'sora-2-pro'],
    deprecated: ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini', 'gpt-4.5-preview', 'dall-e-2'] },
  { id: 'anthropic', name: 'Anthropic', base: 'https://api.anthropic.com/v1', type: 'anthropic', models: [
    'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-mythos-5', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-opus-4-7',
  ], deprecated: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-sonnet-4', 'claude-opus-4', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest', 'claude-3-sonnet', 'claude-3-haiku', 'claude-2.1'] },
  { id: 'google', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', type: 'openai', models: [
    'gemini-3.1-pro', 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  ], image: ['imagen-3.0-generate-002'], video: ['veo-3.0-generate-preview', 'veo-2.0-generate-001'],
    deprecated: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-3-pro-preview', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro', 'gemini-pro-vision'] },
  { id: 'xai', name: 'xAI', base: 'https://api.x.ai/v1', type: 'openai', models: [
    'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini',
  ], image: ['grok-2-image'], deprecated: ['grok-2-vision-1212', 'grok-2', 'grok-beta'] },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', type: 'openai', models: [
    'deepseek-v4-pro', 'deepseek-v4-flash',
  ], deprecated: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-v2.5'] },
  { id: 'xiaomi', name: '小米 MiMo', base: 'https://api.xiaomimimo.com/v1', type: 'openai', models: [
    'mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-tts',
  ], deprecated: ['mimo-v1', 'MiMo-7B-RL', 'MiMo-7B-SFT', 'MiMo-7B-Base', 'MiMo-VL-7B-RL'] },
  { id: 'aliyun', name: '阿里云 · 通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', type: 'openai', models: [
    'qwen3-max', 'qwen3-coder-plus', 'qwen3-coder-flash', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen3-235b-a22b', 'qwen3-32b', 'qwen3-14b', 'qwen3-8b', 'qwen-vl-max', 'qwen-vl-plus', 'qwq-32b',
  ], image: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus'], video: ['wanx2.1-t2v-turbo', 'wanx2.1-t2v-plus'],
    deprecated: ['qwen-max', 'qwen2.5-72b-instruct', 'qwen2.5-32b-instruct', 'qwen2.5-14b-instruct', 'qwen2.5-7b-instruct', 'qwen2-72b-instruct', 'qwen1.5-110b-chat'] },
  { id: 'tencent', name: '腾讯云 · 混元', base: 'https://api.hunyuan.cloud.tencent.com/v1', type: 'openai', models: [
    'hunyuan-t1-latest', 'hunyuan-turbos-latest', 'hunyuan-turbo', 'hunyuan-pro', 'hunyuan-vision',
  ], deprecated: ['hunyuan-standard', 'hunyuan-lite', 'hunyuan-standard-256K', 'hunyuan-code'] },
  { id: 'baidu', name: '百度 · 文心一言', base: 'https://qianfan.baidubce.com/v2', type: 'openai', models: [
    'ernie-4.5-turbo-128k', 'ernie-4.5-8k-preview', 'ernie-x1-turbo-32k', 'ernie-4.0-8k', 'ernie-3.5-8k',
  ], deprecated: ['ernie-speed-8k', 'ernie-lite-8k', 'ernie-tiny-8k', 'ernie-bot-4', 'ernie-bot'] },
  { id: 'bytedance', name: '字节跳动 · 豆包', base: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai', models: [
    'doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260215', 'doubao-seed-2-0-mini-260215', 'doubao-seed-2-0-code-preview-260215', 'doubao-seed-1-8-251228',
  ], image: ['doubao-seedream-4-0', 'doubao-seedream-3-0-t2i'], video: ['doubao-seedance-1-0-pro', 'doubao-seedance-1-0-lite-t2v'],
    deprecated: ['doubao-seed-1-6', 'doubao-seed-1-6-flash', 'doubao-seed-1-6-thinking', 'doubao-1.5-pro-32k', 'doubao-1.5-pro-256k', 'doubao-1.5-lite-32k', 'doubao-vision-pro-32k', 'deepseek-r1-250528', 'deepseek-v3-250324', 'doubao-pro-32k', 'doubao-lite-32k', 'doubao-pro-128k', 'doubao-vision-lite-32k'] },
  { id: 'moonshot', name: '月之暗面 · Kimi', base: 'https://api.moonshot.cn/v1', type: 'openai', models: [
    'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6',
  ], deprecated: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-preview', 'kimi-latest', 'moonshot-v1-auto', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-thinking-preview', 'moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview'] },
  { id: 'zhipu', name: '智谱 AI', base: 'https://open.bigmodel.cn/api/paas/v4', type: 'openai', models: [
    'glm-5.2', 'glm-5', 'glm-4.6',
  ], image: ['cogview-3-plus', 'cogview-4'], video: ['cogvideox-2', 'cogvideox-flash'],
    deprecated: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus', 'glm-z1-air', 'glm-4-long', 'glm-4-0520', 'glm-4-0111', 'glm-3-turbo', 'chatglm3-6b'] },
  { id: 'yi', name: '零一万物', base: 'https://api.lingyiwanwu.com/v1', type: 'openai', models: [
    'yi-lightning', 'yi-large', 'yi-medium', 'yi-vision',
  ], deprecated: ['yi-spark', 'yi-34b-chat', 'yi-6b-chat'] },
  { id: 'sensechat', name: '商汤 · 商量', base: 'https://api.sensenova.cn/v1', type: 'openai', models: [
    'SenseChat-5', 'SenseChat-5-128K', 'SenseChat-Turbo',
  ], deprecated: ['SenseChat-4', 'SenseChat-32K'] },
  { id: 'minimax', name: 'MiniMax', base: 'https://api.minimax.chat/v1', type: 'openai', models: [
    'MiniMax-M2', 'MiniMax-M1', 'MiniMax-Text-01',
  ], image: ['image-01'], video: ['MiniMax-Hailuo-02', 'T2V-01'],
    deprecated: ['abab6.5s-chat', 'abab6.5-chat', 'abab5.5-chat', 'abab5.5s-chat'] },
  { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', type: 'openai', models: [
    'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-32B-Instruct', 'Qwen/Qwen2.5-14B-Instruct', 'Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat', 'meta-llama/Meta-Llama-3.1-70B-Instruct', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'Qwen/QwQ-32B',
  ], image: ['Kwai-Kolors/Kolors', 'stabilityai/stable-diffusion-3-5-large'],
    deprecated: ['internlm/internlm2_5-20b-chat', 'Qwen/Qwen2-72B-Instruct', 'meta-llama/Meta-Llama-3-70B-Instruct'] },
  { id: 'baichuan', name: '百川智能', base: 'https://api.baichuan-ai.com/v1', type: 'openai', models: [
    'Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k',
  ], deprecated: ['Baichuan2-Turbo', 'Baichuan2-Turbo-192k', 'Baichuan2-13B-Chat'] },
  { id: 'stepfun', name: '阶跃星辰', base: 'https://api.stepfun.com/v1', type: 'openai', models: [
    'step-2-16k', 'step-1-8k', 'step-1-32k', 'step-1-128k', 'step-1v-8k', 'step-1.5v-mini',
  ], deprecated: ['step-1-256k', 'step-1v-32k'] },
  { id: 'spark', name: '讯飞星火', base: 'https://spark-api-open.xf-yun.com/v1', type: 'openai', models: [
    '4.0Ultra', 'generalv3.5', 'max-32k', 'generalv3',
  ], deprecated: ['lite', 'generalv2', 'general'] },
  { id: 'tiangong', name: '天工 AI', base: 'https://sky-api.singularity-ai.com/saas/api/v1', type: 'openai', models: [
    'sky-chat', 'Skywork-o1-Open',
  ], deprecated: ['sky-chat-v3.5'] },
  { id: 'qihoo', name: '360 智脑', base: 'https://api.360.cn/v1', type: 'openai', models: [
    '360gpt-pro', '360gpt-turbo', '360gpt2-pro',
  ], deprecated: ['360gpt-turbo-32k', '360gpt_s2_v9'] },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', type: 'openai', models: [
    'mistral-large-latest', 'mistral-large-3', 'mistral-saba-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'pixtral-large-latest', 'ministral-8b-latest', 'open-mistral-nemo',
  ], deprecated: ['mistral-large-2407', 'mistral-small-2402', 'open-mistral-7b', 'open-mixtral-8x22b'] },
  { id: 'cohere', name: 'Cohere', base: 'https://api.cohere.com/compatibility/v1', type: 'openai', models: [
    'command-r-plus', 'command-r', 'command-r7b', 'command-a-03-2025',
  ], deprecated: ['command', 'command-light', 'command-nightly'] },
  { id: 'perplexity', name: 'Perplexity', base: 'https://api.perplexity.ai', type: 'openai', models: [
    'sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro',
  ], deprecated: ['sonar-small-online', 'sonar-medium-online', 'llama-3.1-sonar-large-128k-online'] },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', type: 'openai', models: [
    'llama-4-maverick', 'llama-4-scout', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'llama3-8b-8192', 'deepseek-r1-distill-llama-70b', 'gemma2-9b-it',
  ], deprecated: ['mixtral-8x7b-32768', 'llama2-70b-4096', 'gemma-7b-it'] },
  { id: 'together', name: 'Together AI', base: 'https://api.together.xyz/v1', type: 'openai', models: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1',
  ], deprecated: ['mistralai/Mixtral-8x22B-Instruct-v0.1', 'meta-llama/Llama-3-70b-chat-hf'] },
  { id: 'fireworks', name: 'Fireworks', base: 'https://api.fireworks.ai/inference/v1', type: 'openai', models: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/llama-v3p1-405b-instruct', 'accounts/fireworks/models/deepseek-v3', 'accounts/fireworks/models/deepseek-r1', 'accounts/fireworks/models/qwen2p5-72b-instruct',
  ], deprecated: ['accounts/fireworks/models/llama-v3-70b-instruct'] },
  { id: 'replicate', name: 'Replicate', base: '', type: 'openai', models: [], deprecated: [] },
  { id: 'stability', name: 'Stability AI', base: '', type: 'openai', models: [], image: ['stable-diffusion-3-5-large', 'stable-image-ultra'], deprecated: ['stable-diffusion-xl-1024-v1-0', 'stable-diffusion-v1-6'] },
  { id: 'midjourney', name: 'Midjourney（第三方接入）', base: '', type: 'openai', models: [], image: ['midjourney-v6.1'], video: ['mj-video-1'], deprecated: ['midjourney-v5', 'midjourney-v6'] },
  { id: 'openrouter', name: 'OpenRouter（聚合）', base: 'https://openrouter.ai/api/v1', type: 'openai', models: [
    'openai/gpt-5.2', 'anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'google/gemini-3.1-pro', 'deepseek/deepseek-v4-pro', 'moonshotai/kimi-k3', 'x-ai/grok-4-1', 'qwen/qwen3-max',
  ], deprecated: ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat', 'deepseek/deepseek-r1', 'x-ai/grok-3', 'mistralai/mistral-large', 'openai/gpt-3.5-turbo'] },
  { id: 'azure', name: 'Azure OpenAI', base: '', type: 'openai', models: [], deprecated: [] },
  { id: 'nvidia', name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', type: 'openai', models: [
    'meta/llama-4-maverick-instruct', 'meta/llama-4-scout-instruct', 'nvidia/nemotron-h-70b', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-72b-instruct', 'mistralai/mistral-large-2-instruct',
  ], deprecated: ['meta/llama-3.1-70b-instruct'] },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', base: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', type: 'openai', models: ['@cf/meta/llama-3.3-70b-instruct', '@cf/meta/llama-4-maverick-instruct', '@cf/qwen/qwen2.5-72b-instruct', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'], deprecated: ['@cf/meta/llama-3.1-8b-instruct'] },
  { id: 'custom', name: '自定义提供商', base: '', type: 'openai', models: [], deprecated: [] },
];

/* v5.4：厂商 API Key 创建页与简介（配置弹窗「去创建」跳转） */
export const PROVIDER_SITES = {
  openai: { create: 'https://platform.openai.com/api-keys', intro: 'OpenAI 官方平台，Key 以 sk- 开头；按用量计费，可开通 Plus 会员获得高级模型额度' },
  anthropic: { create: 'https://console.anthropic.com/settings/keys', intro: 'Anthropic 官方控制台，Key 以 sk-ant- 开头；按 Token 计费' },
  google: { create: 'https://aistudio.google.com/apikey', intro: 'Google AI Studio 免费获取 Gemini API Key（AIza 开头）' },
  xai: { create: 'https://console.x.ai', intro: 'xAI 控制台，Key 以 xai- 开头；Grok 系列模型' },
  deepseek: { create: 'https://platform.deepseek.com/api_keys', intro: 'DeepSeek 开放平台，Key 以 sk- 开头；价格低廉、中文优秀' },
  xiaomi: { create: 'https://platform.xiaomimimo.com', intro: '小米 MiMo 开放平台：支持按量付费与会员计划两种计费，Key 以 tp- 开头；会员计划请求头与按量不同，请在下方选择对应模式' },
  aliyun: { create: 'https://bailian.console.aliyun.com/', intro: '阿里云百炼平台（通义千问），使用 DashScope API Key（sk- 开头）' },
  tencent: { create: 'https://console.cloud.tencent.com/hunyuan', intro: '腾讯云混元大模型控制台' },
  baidu: { create: 'https://console.bce.baidu.com/qianfan/ais/console/onlineTest', intro: '百度智能云千帆平台（文心一言）' },
  bytedance: { create: 'https://console.volcengine.com/ark', intro: '火山引擎方舟平台（豆包），创建推理接入点后使用' },
  moonshot: { create: 'https://platform.moonshot.cn/console/api-keys', intro: '月之暗面 Kimi 开放平台，Key 以 sk- 开头' },
  zhipu: { create: 'https://open.bigmodel.cn/usercenter/apikeys', intro: '智谱 AI 开放平台，Key 为 数字.数字.数字 格式' },
  siliconflow: { create: 'https://cloud.siliconflow.cn/account/ak', intro: '硅基流动平台：聚合 DeepSeek/Qwen 等开源模型，注册送免费额度' },
  minimax: { create: 'https://platform.minimaxi.com', intro: 'MiniMax 开放平台（海螺 / 星野）' },
  stepfun: { create: 'https://platform.stepfun.com', intro: '阶跃星辰 Step 开放平台' },
  spark: { create: 'https://console.xfyun.cn/services/bm3', intro: '讯飞星火开放平台' },
  mistral: { create: 'https://console.mistral.ai/api-keys', intro: 'Mistral AI 欧洲开源模型平台' },
  cohere: { create: 'https://dashboard.cohere.com/api-keys', intro: 'Cohere Command 系列企业级模型' },
  perplexity: { create: 'https://www.perplexity.ai/settings/api', intro: 'Perplexity Sonar 联网搜索模型，Key 以 pplx- 开头' },
  groq: { create: 'https://console.groq.com/keys', intro: 'Groq 极速推理平台，Key 以 gsk_ 开头，Llama 系列免费额度' },
  openrouter: { create: 'https://openrouter.ai/settings/keys', intro: 'OpenRouter 聚合平台：一个 Key 用全部模型，Key 以 sk-or- 开头' },
  nvidia: { create: 'https://build.nvidia.com', intro: 'NVIDIA NIM 平台，Key 以 nvapi- 开头' },
  together: { create: 'https://api.together.ai/settings/api-keys', intro: 'Together AI 开源模型托管平台' },
  fireworks: { create: 'https://fireworks.ai/api-keys', intro: 'Fireworks AI 模型托管平台' },
};
/* v5.5：国内 / 国外厂商区分（国外模型可能被墙，国内优先展示） */
const CN_PROVIDERS = ['deepseek', 'zhipu', 'moonshot', 'aliyun', 'tencent', 'baidu', 'bytedance', 'xiaomi', 'minimax', 'baichuan', 'stepfun', 'spark', 'siliconflow', 'yi', 'sensechat', 'tiangong', 'qihoo', 'custom'];
export function isCnProvider(id) { return CN_PROVIDERS.includes(id); }
/* 国内置顶顺序：deepseek 第 1、kimi 第 2，其余国内厂商按列表顺序，之后才是国外 */
export function sortProviders(list) {
  const prio = { deepseek: 0, moonshot: 1 };
  const rank = (p) => {
    if (prio[p.id] != null) return prio[p.id];
    if (isCnProvider(p.id)) return 10;
    return 20;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}
export function providerSite(id) { return PROVIDER_SITES[id] || null; }

/* v5.4：模型能力标签（上下文窗口 / 模态）——按规则匹配，约值标注 */
const CAP_RULES = [
  [/^gpt-|^o[0-9]/, '400K', 'vision'],
  [/^claude-/, '1M', 'vision'],
  [/^gemini-/, '1M', 'vision'],
  [/^deepseek-/, '128K', 'text'],
  [/^kimi-/, '128K', 'vision'],
  [/^glm-/, '128K', 'vision'],
  [/^qwen/, '128K', 'vision'],
  [/^doubao-|^seed/, '128K', 'vision'],
  [/^hunyuan/, '256K', 'vision'],
  [/^ernie-/, '128K', 'vision'],
  [/^mimo-/, '128K', 'vision'],
  [/^MiniMax-/, '128K', 'vision'],
  [/^grok-/, '256K', 'vision'],
  [/^llama-|^Llama/, '128K', 'vision'],
  [/^mistral|^codestral|^pixtral/, '128K', 'vision'],
  [/^command-/, '128K', 'text'],
  [/^sonar/, '128K', 'text'],
  [/^SenseChat/, '128K', 'vision'],
  [/^yi-/, '32K', 'text'],
  [/^Baichuan/, '128K', 'text'],
  [/^step-/, '128K', 'text'],
  [/^sky-/, '32K', 'text'],
];
export function modelCaps(providerId, model) {
  const m = String(model || '');
  for (const [re, ctx, modal] of CAP_RULES) if (re.test(m)) {
    const vision = /vision|vl|omni|multimodal|image/i.test(m) ? 'vision' : modal;
    return { ctx, modal: vision };
  }
  return { ctx: '32K', modal: 'text' };
}
export function modelCapTags(providerId, model) {
  const c = modelCaps(providerId, model);
  return `<span class="tag tag-gray" style="font-size:10px;margin-left:6px">${c.ctx}</span><span class="tag ${c.modal === 'vision' ? 'tag-blue' : 'tag-gray'}" style="font-size:10px;margin-left:4px">${c.modal === 'vision' ? '多模态' : '纯文本'}</span>`;
}

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];
}


/* ---------- 自定义厂商动态注册（我的模型） ---------- */
export const modelIdOf = (m) => (typeof m === 'string' ? m : (m && (m.id || m.model)) || '');
export const modelNickOf = (m) => (typeof m === 'string' ? m : (m && (m.nick || m.name || m.id || m.model)) || '');
let __customReady = false;

export async function refreshCustomProviders(force = false) {
  if (__customReady && !force) return PROVIDERS.filter((p) => p.custom);
  let list = [];
  try { list = await kvGet('ai:custom-providers', []); } catch (e) { list = []; }
  for (let i = PROVIDERS.length - 1; i >= 0; i--) if (PROVIDERS[i].custom) PROVIDERS.splice(i, 1);
  clearCustomVendorIcons();
  const customs = (Array.isArray(list) ? list : []).map((cp) => {
    const models = (cp.models || []).map((m) => (typeof m === 'string' ? m : { id: modelIdOf(m), nick: m.nick || m.name || '' })).filter((m) => modelIdOf(m));
    const p = {
      ...cp,
      name: cp.name || '我的厂商',
      base: cp.base || '',
      type: cp.type || 'openai',
      models,
      image: cp.image || [],
      video: cp.video || [],
      deprecated: cp.deprecated || [],
      custom: true,
      dynamic: true,
      group: '我的模型',
    };
    setCustomVendorIcon(p.id, cp.icon || '');
    return p;
  });
  const idx = PROVIDERS.findIndex((p) => p.id === 'custom');
  PROVIDERS.splice(idx < 0 ? PROVIDERS.length : idx, 0, ...customs);
  __customReady = true;
  return customs;
}

export function modelDisplayName(providerId, model) {
  const p = providerById(providerId);
  const hit = (p.models || []).find((m) => modelIdOf(m) === model);
  return hit ? modelNickOf(hit) : model;
}

/* 厂商全部模型（对话 + 绘画 + 视频 + 历史） */
export function providerAllModels(p) {
  return [
    ...(p.models || []),
    ...(p.image || []),
    ...(p.video || []),
    ...(p.deprecated || []),
  ];
}

/* 统计模型总数 */
export function totalModelCount() {
  return PROVIDERS.reduce((n, p) => n + (p.models ? p.models.length : 0) + (p.image ? p.image ? p.image.length : 0 : 0) + (p.video ? p.video.length : 0), 0);
}
