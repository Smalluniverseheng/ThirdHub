# 网站版备份与回退说明

ThirdHub 网站版有三层备份，任何一层都可以把站点恢复到历史版本。

## 三层备份

| 层 | 位置 | 说明 |
|---|---|---|
| Git 历史 + 标签 | GitHub `Smalluniverseheng/ThirdHub` | 每次发布一个 commit，关键节点打 tag |
| Cloudflare Pages 部署记录 | CF Pages 项目 `thirdhub` | 每次部署有独立 deployment ID，可在控制台一键回滚（Rollback） |
| 预览快照 | 发布流水线快照 | 每次发布保存一份完整站点快照 |

## 当前备份点

| 版本 | Git commit | Git 标签 | CF Pages 部署 | 预览快照 |
|---|---|---|---|---|
| v2.1 | `ec8faa7` | — | `e344f7a2` | `f0813ff` |
| v2.2 | `d50598c` | `v2.2`、`backup/v2.2-before-local-ai` | `c75b3b23` | `d8a9862` |
| v2.3 | `b287926` | `v2.3`、`backup/v2.3-before-cloud-backend` | `f3078f84` | `1351f92` |
| v2.4 | `f896f5d` | `v2.4`、`backup/v2.4-before-v2.5-polish` | `9da3de46`（含 _worker.js 云端后端） | 见发布记录 |
| v2.5 | `92d5211` | `v2.5`、`backup/v2.5-before-drawer-header` | `61e114c5`（wrangler 部署，含云端后端） | `07eeb6f` |
| v2.6 | `3cff4e1` | `v2.6` | `252592a1`（wrangler 部署，含云端后端） | `0dcb5c2` |
| v2.7 | 已随 v3.9 全量同步（见 v3.9 行） | `backup/v2.6-before-source-fix` 待补 | `094e36e4`（wrangler 部署，含 /api/proxy 中转） | `d5fc399` |
| v2.8 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `f860b407`（代码）、`8a7a3042`（含回滚文档） | `e7d2529` |
| v2.9 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `5e0a4886`（旧连接器自动升级新规则引擎） | `d87c1b6` |
| v3.0 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `7f2d6269`（规则引擎 id./class./tag./text./!N/## + 源仓库 + 裸URL导入） | `e9bd0f9` |
| v3.1 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `80025fa9`（搜索列表左图右文、封面/插图中转、云端组件本地化） | `239d940` |
| v3.2 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `8ab9abda`（板块默认书架、搜索收起放大镜） | `b4c435c` |
| v3.3 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `7c1e6a07`（正文HTML渲染修复、听书控制条+语速+连读） | `f89785a` |
| v3.4 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `abd3d8cc`（下拉添加书签、目录面板书签页签） | `a03bbae` |
| v3.5 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `d81ac029`（书源正文修复 @css:/tocUrl/replaceRegex/POST+GBK、阅读器底栏仿番茄、公告刷新、板块纯书架） | `15b505f` |
| v3.6 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `aa25396c`（Venera 运行时补 loadSetting、连接器筛选+一键全测+动画、设置控件全局化、AI 图标库+模型更新 2026-08） | `40587ff` |
| v3.7 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `d3810180`（代理黑名单转发修复漫画图片、同步 hmac、小说/漫画/有声合并「阅读」板块、Lucide 设置齿轮） | `7f0bdca` |
| v3.8 | 已随 v3.9 全量同步（见 v3.9 行） | 待补 | `8e605848`（类型筛选联动连接器列表、源内单源搜索、有声类型自动识别、推荐仓库、TVbox 仓库/视频解析增强） | `dd9da0f` |
| v3.9 | `af6178c`（tag `v3.9`，含 v2.7–v3.9 全量累积） | `v3.9` | `88a00a34`（Venera 引擎对齐官方：搜索选项默认值、loadNext、异步 init、IIFE 隔离、同步 AES/MD5/SHA/HMAC、APP 全局、JSON Content-Type） | `e22e130` |
| v4.0 | `c3e96f5`（tag `v4.0`） | `v4.0` | `5d9ec420`（Venera 图源图片修复：封面/正文反混淆 modifyImage、onThumbnailLoad/onImageLoad 头注入、评论/标签/推荐、源驱动发现页+查看更多、详情页安全富文本；部署修正 _worker.js 挂载） | `9181e53` |
| v4.1 | `b8c0622`（tag `v4.1`） | `v4.1` | `a05ce050`（漫画线程数 1–32 可调+并发预取池、退出即取消；搜索流式逐条出结果、点书即中止优先打开；小说开始阅读自动下载本章、换章/退出作废；音乐模块支持落雪 LX 自定义源脚本，内置酷我/酷狗/咪咕/QQ/网易五平台搜索；音乐播放地址不缓存） | `a05ce050`（CF 部署快照 https://a05ce050.thirdhub.pages.dev） |
| v4.2 | `cb8b9d6`（tag `v4.2`） | `v4.2` | `ddf08b0e`（wrangler 部署，含云端后端。视频播放器学习 TVBox 全量重写：自定义进度条+缓冲+拖动预览、倍速三方式、六种画面比例、片头片尾跳过、全手势、锁定、键盘快捷键；多端屏幕自适应 watch/narrow/phone/fold/tablet/desktop） | `ddf08b0e`（CF 部署快照 https://ddf08b0e.thirdhub.pages.dev） |
| v4.3 | `98743cf`（tag `v4.3`） | `v4.3` | `1484f8e5`（wrangler 部署，含云端后端。官方仓库：Supabase th_official_repo 表 + RPC 密码门（初始123456）+ 管理后台批量上传自动分类；devlog Error 序列化修复；书架宫格番茄风格） | `1484f8e5`（CF 部署快照 https://1484f8e5.thirdhub.pages.dev） |
| v4.5 | `a18dce8`（tag `v4.5`） | `v4.5` | `2a69f4cb`（wrangler 部署，含云端后端。阅读板块四子页签 发现/书架/历史/收藏；发现页按连接器细分；AI搜索框仅历史会话；漫画图片统一中转带Referer修复JM加载） | `2a69f4cb`（CF 部署快照 https://2a69f4cb.thirdhub.pages.dev） |
| v4.4 | `8e09da2`（tag `v4.4`） | `v4.4` | `87f4b983`（wrangler 部署，含云端后端。品牌图标样式全局化修复开屏图标混乱；阅读板块新增 发现/书架 子页签，默认书架；GitHub 改用 PAT+ghfast 镜像直推） | `87f4b983`（CF 部署快照 https://87f4b983.thirdhub.pages.dev） |

## 回退方法

**方法一：Cloudflare 控制台回滚（最快，1 分钟）**
Pages 项目 → Deployments → 找到目标部署 → Rollback。主站立即回到该版本。

**方法二：Git 回退（彻底）**
```bash
git reset --hard backup/v2.2-before-local-ai
git push --force
```
然后重新部署到 Cloudflare Pages。

**方法三：预览快照恢复**
用对应快照 ID 重新发布即可。

## 约定

- 每次大改造前，先在当前稳定版上打 `backup/...` 标签再动工。
- 版本号统一 `x.y` 格式，同步更新：`js/app.js`、`sw.js`、`index.html`/`admin.html` 的 `?v=`、`js/changelog.js`（追加在末尾）、`version.json`。
