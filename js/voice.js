/* ===== ThirdHub js/voice.js — 语音输入（ASR）+ 语音输出（TTS 多引擎） v1.5 =====
   TTS 引擎：系统自带 / 小米 MiMo TTS / 火山引擎 / 自定义 OpenAI 兼容接口
   ASR：浏览器 Web Speech API（按住说话 continuous 模式） */
import { canSpeechRecognize, canTTS } from './device.js';
import { getSetting, kvGet } from './store.js';

let recog = null;

export function startRecognition({ lang = 'zh-CN', continuous = false, onResult, onEnd, onError }) {
  if (!canSpeechRecognize()) { onError && onError(new Error('当前浏览器不支持语音识别')); return null; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.lang = lang;
  recog.interimResults = true;
  recog.continuous = continuous;
  recog.onresult = (e) => {
    let final = '', interim = '';
    for (const r of e.results) (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
    onResult && onResult(final, interim);
  };
  recog.onend = () => onEnd && onEnd();
  recog.onerror = (e) => onError && onError(e);
  recog.start();
  return recog;
}
export function stopRecognition() { try { recog && recog.stop(); } catch (e) {} recog = null; }

/* ---------- 录音（模型 ASR：MediaRecorder → Blob） ---------- */
export async function startRecorder() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.start(200);
    let canceled = false;
    const cleanup = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {} };
    return {
      cancel() { canceled = true; try { mr.stop(); } catch (e) {} cleanup(); },
      stop() {
        return new Promise((resolve) => {
          mr.onstop = () => {
            cleanup();
            resolve(canceled ? null : new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
          };
          try { mr.stop(); } catch (e) { cleanup(); resolve(null); }
        });
      },
    };
  } catch (e) { return null; }
}

/* ---------- TTS 引擎 ---------- */
export const TTS_ENGINES = [
  { id: 'system', name: '系统自带', desc: '使用浏览器/系统语音合成，无需配置' },
  { id: 'xiaomi', name: '小米 MiMo TTS', desc: 'mimo-v2-tts，使用「小米 MiMo」厂商 Key' },
  { id: 'volc', name: '火山引擎语音', desc: 'doubao-tts，使用「字节跳动 · 豆包」厂商 Key' },
  { id: 'edge', name: '自定义 TTS 接口', desc: '任意 OpenAI 兼容 /audio/speech 服务' },
];

const TTS_CONF = {
  xiaomi: { provider: 'xiaomi', base: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2-tts', voice: 'mimo_default' },
  volc: { provider: 'bytedance', base: 'https://openspeech.bytedance.com/api/v3/tts', model: 'doubao-tts', voice: 'zh_female_qingxin' },
  edge: { provider: null, base: '', model: 'tts-1', voice: 'zh-CN-XiaoxiaoNeural' },
};

let curAudio = null;
let speaking = false;

/* 云端 TTS：OpenAI 兼容 POST {base}/audio/speech → 音频流 */
async function speakCloud(clean, conf) {
  const { getApiKey, getBaseOverride } = await import('./ai/ai-api.js');
  let base = conf.base;
  let key = '';
  if (conf.provider) {
    key = await getApiKey(conf.provider);
    if (!key) throw new Error(`请先配置「${conf.provider === 'xiaomi' ? '小米 MiMo' : '字节跳动'}」的 API Key`);
    base = (await getBaseOverride(conf.provider)) || base;
  } else {
    base = await getSetting('ttsCustomUrl');
    if (!base) throw new Error('请先在「个性化设置」中填写自定义 TTS 地址');
  }
  const resp = await fetch(base.replace(/\/$/, '') + '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify({ model: conf.model, voice: conf.voice, input: clean }),
  });
  if (!resp.ok) throw new Error('TTS 请求失败 HTTP ' + resp.status);
  const blob = await resp.blob();
  curAudio = new Audio(URL.createObjectURL(blob));
  speaking = true;
  curAudio.onended = () => { speaking = false; curAudio = null; };
  curAudio.onerror = () => { speaking = false; curAudio = null; };
  await curAudio.play();
  return true;
}

export async function speak(text, { rate = 1, pitch = 1, lang = 'zh-CN' } = {}) {
  stopSpeak();
  const clean = String(text).replace(/[#*`>\-]|```[\s\S]*?```/g, ' ').slice(0, 2000);
  const engine = await getSetting('ttsEngine');
  const mode = await kvGet('ai:tts-mode', 'auto'); // system | cloud | auto
  if (mode !== 'system' && engine && engine !== 'system' && TTS_CONF[engine]) {
    const conf = { ...TTS_CONF[engine] };
    const v = await kvGet('ai:tts-voice', '');
    if (v) conf.voice = v;
    const mdl = await kvGet('ai:tts-model', '');
    if (mdl) conf.model = mdl;
    try {
      return await speakCloud(clean, conf);
    } catch (e) {
      if (mode === 'cloud') { console.warn('云端 TTS 失败：', e.message); return false; }
      console.warn('云端 TTS 失败，回退系统语音：', e.message);
      // auto 模式：失败后回退系统语音
    }
  }
  if (!canTTS()) return false;
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = rate; u.pitch = pitch; u.lang = lang;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('zh'));
  if (voices[0]) u.voice = voices[0];
  speechSynthesis.speak(u);
  speaking = true;
  u.onend = () => (speaking = false);
  return true;
}

export function stopSpeak() {
  if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; }
  if (canTTS()) speechSynthesis.cancel();
  speaking = false;
}
export function isSpeaking() { return speaking || !!curAudio; }
