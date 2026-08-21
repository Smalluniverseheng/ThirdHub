/* ===== ThirdHub device.js — 设备/平台检测 ===== */
export const device = {
  isMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
  isAndroid: /Android/i.test(navigator.userAgent),
  isDesktop: !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  isPWA: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  isTouch: 'ontouchstart' in window,
  get isWatch() { return screen.width < 380 && this.isTouch; },
};

export function canSpeechRecognize() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
export function canTTS() { return 'speechSynthesis' in window; }
export function canPiP() { return document.pictureInPictureEnabled === true; }
