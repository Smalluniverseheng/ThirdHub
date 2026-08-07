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
| v2.4 | `f896f5d` | `v2.4` | `9da3de46`（含 _worker.js 云端后端） | 见发布记录 |

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
