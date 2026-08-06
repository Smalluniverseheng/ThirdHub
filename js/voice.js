/* ===== ThirdHub js/voice.js — 语音输入（Web Speech API）+ 语音输出（TTS） ===== */
import { canSpeechRecognize, canTTS } from './device.js';

let recog = null;

export function startRecognition({ lang = 'zh-CN', onResult, onEnd, onError }) {
  if (!canSpeechRecognize()) { onError && onError(new Error('当前浏览器不支持语音识别')); return null; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.lang = lang;
  recog.interimResults = true;
  recog.continuous = false;
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
export function stopRecognition() { try { recog && recog.stop(); } catch (e) {} }

/* ---------- TTS ---------- */
let speaking = false;
export function speak(text, { rate = 1, pitch = 1, lang = 'zh-CN' } = {}) {
  if (!canTTS()) return false;
  stopSpeak();
  const clean = String(text).replace(/[#*`>\-]|```[\s\S]*?```/g, ' ').slice(0, 2000);
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = rate; u.pitch = pitch; u.lang = lang;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('zh'));
  if (voices[0]) u.voice = voices[0];
  speechSynthesis.speak(u);
  speaking = true;
  u.onend = () => (speaking = false);
  return true;
}
export function stopSpeak() { if (canTTS()) speechSynthesis.cancel(); speaking = false; }
export function isSpeaking() { return speaking; }
