/* ===== ThirdHub boards.js — 板块注册表（每个板块独立、按需加载） =====
   未加入底部导航的板块：代码不下载、不执行、不渲染。
   用户在「我的 → 导航栏管理」中增删板块（至少 1 个，最多 5 个）。 */

export const BOARDS = [
  { id: 'ai',         name: 'AI',    ico: 'robot',     cat: 'ai',   desc: '多厂商 AI 对话 · 流式输出 · MCP · 联网搜索', load: () => import('./modules/ai-chat.js'),          fn: 'renderAIChat' },
  { id: 'novel',      name: '小说',   ico: 'book',      cat: 'fun',  desc: '网络小说搜索、阅读与书架',                 load: () => import('./modules/board-media.js'),       fn: 'renderMediaBoard', arg: 'novel' },
  { id: 'comic',      name: '漫画',   ico: 'comic',     cat: 'fun',  desc: '漫画搜索与阅读',                           load: () => import('./modules/board-media.js'),       fn: 'renderMediaBoard', arg: 'comic' },
  { id: 'music',      name: '音乐',   ico: 'music',     cat: 'fun',  desc: '音乐搜索与播放',                           load: () => import('./modules/board-media.js'),       fn: 'renderMediaBoard', arg: 'music' },
  { id: 'audio',      name: '有声',   ico: 'headphone', cat: 'fun',  desc: '有声书 / 广播剧收听',                      load: () => import('./modules/board-media.js'),       fn: 'renderMediaBoard', arg: 'audio' },
  { id: 'video',      name: '视频',   ico: 'film',      cat: 'fun',  desc: '影视 / 短剧搜索与播放',                    load: () => import('./modules/board-media.js'),       fn: 'renderMediaBoard', arg: 'video' },
  { id: 'game',       name: '游戏',   ico: 'game',      cat: 'fun',  desc: 'H5 小游戏收藏与即点即玩',                  load: () => import('./modules/board-game.js'),        fn: 'renderGameBoard' },
  { id: 'storage',    name: '存储',   ico: 'cloud',     cat: 'tool', desc: '云存储容量、数据备份与恢复',               load: () => import('./modules/board-storage.js'),     fn: 'renderStorageBoard' },
  { id: 'cloudphone', name: '云手机', ico: 'phone',     cat: 'tool', desc: '云端安卓实例（即将上线）',                 load: () => import('./modules/board-cloudphone.js'),  fn: 'renderCloudPhoneBoard' },
];

/* 「我的」固定存在，不占 5 个板块名额 */
export const PROFILE_BOARD = { id: 'profile', name: '我的', ico: 'user', load: () => import('./modules/profile.js'), fn: 'renderProfile' };

export const MAX_TABS = 5;
export const MIN_TABS = 1;

export function boardById(id) {
  if (id === PROFILE_BOARD.id) return PROFILE_BOARD;
  return BOARDS.find((b) => b.id === id);
}
