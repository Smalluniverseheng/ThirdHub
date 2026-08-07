# 第三方科技 · ThirdHub

全平台智能聚合平台：AI 对话（270+ 模型 / 4 种模式 / 语音 / 绘画 / 联网 / MCP）+ 通用内容阅读框架（小说 / 漫画 / 影视 / 听书 / 音乐 / 短剧）+ 会员体系 + 管理后台。

## 核心原则：零内置内容源

**ThirdHub 是一个通用的内容聚合框架，软件本身不预置、不托管、不分发任何第三方内容源。**
所有内容接入能力（书源 / 图源 / 视频源 / 音频源）均由用户自行导入配置后启用，全部连接器脚本在浏览器 Web Worker 沙箱内隔离运行。

## 技术栈

- Vanilla JS (ES6+ Module) + CSS3 Variables，无构建工具
- PWA（Service Worker + Manifest），可安装到 Android / iOS / 桌面主屏
- IndexedDB 本地存储，Supabase 云端同步（Realtime，离线优先）
- hls.js 视频播放，Chart.js 后台图表，Phosphor Icons 图标

## 部署

GitHub Pages 直接部署 `main` 分支根目录即可。

## 版本号规范

x.y 格式（禁止 x.y.z）。发版同步 4 处：`js/app.js` APP_VERSION、`index.html` 全部 `?v=X.Y`、`sw.js` VERSION、`js/changelog.js` 末尾追加。

## 相关仓库

- 管理后台：[ThirdHub-Admin](https://github.com/Smalluniverseheng/ThirdHub-Admin)
