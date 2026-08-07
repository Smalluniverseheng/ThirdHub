# ThirdHub 连接器开发规范

> ThirdHub 零内置内容源。所有内容接入能力由用户自行编写/导入连接器（`.js` 文件）后启用。连接器在 Web Worker 沙箱中隔离执行，无法访问页面 DOM 与本地文件系统。

## 1. 连接器声明头（必须）

```js
// @name        连接器名称
// @version     1.0
// @author      作者
// @url         https://example.com
// @type        novel        # novel | comic | video | audio | music
// @enabled     true
```

## 2. 必须实现的 4 个函数

```js
// 搜索：返回数组
async function search(keyword, page) {
  return [{ name, author, coverUrl, bookUrl, intro }];
}

// 详情：返回对象
async function bookInfo(bookUrl) {
  return { name, author, coverUrl, intro, lastUpdate };
}

// 目录/选集：返回数组（url 为该章节的标识，将传给 chapterContent）
async function chapterList(bookUrl) {
  return [{ name, url, vip: false, duration: '12:34' }];
}

// 内容：按类型返回不同结构
async function chapterContent(chapterUrl) {
  // novel: 返回纯文本字符串
  // comic: 返回 JSON.stringify(["imgUrl1", "imgUrl2", ...])
  // video: 返回 JSON.stringify({ title, urls: [{ name: "线路1", url: "https://...m3u8" }] })
  // audio/music: 返回 JSON.stringify({ title, url, duration, coverUrl })
}
```

## 3. 沙箱注入 API（`legado` 对象）

| API | 说明 |
|---|---|
| `await legado.http.get(url, headers?)` | HTTP GET，自动三级代理回退 |
| `await legado.http.post(url, body, headers?)` | HTTP POST |
| `legado.dom.parse(html)` | HTML → Document |
| `legado.dom.select(doc, sel)` / `selectAll` | CSS 选择器 |
| `legado.dom.text(el)` / `html(el)` / `attr(el, name)` | 提取内容 |
| `legado.base64Encode/Decode(str)` | Base64 |
| `legado.md5(str)` / `await legado.sha1(str)` / `await legado.sha256(str)` | 哈希 |
| `legado.urlEncode/Decode(str)` | URL 编码 |
| `legado.jsonPath(obj, "a.b[0].c")` | JSON 取值 |
| `legado.log(msg)` | 日志（测试工具可见） |

## 4. 最小示例

```js
// @name        示例小说源
// @version     1.0
// @url         https://example.com
// @type        novel
// @enabled     true

const BASE = 'https://example.com';

async function search(keyword, page) {
  const html = await legado.http.get(BASE + '/search?q=' + legado.urlEncode(keyword));
  const doc = legado.dom.parse(html);
  return legado.dom.selectAll(doc, '.book-item').map((el) => ({
    name: legado.dom.text(legado.dom.select(el, '.title')),
    author: legado.dom.text(legado.dom.select(el, '.author')),
    coverUrl: legado.dom.attr(legado.dom.select(el, 'img'), 'src'),
    bookUrl: legado.dom.attr(legado.dom.select(el, 'a'), 'href'),
    intro: '',
  }));
}

async function bookInfo(bookUrl) {
  const doc = legado.dom.parse(await legado.http.get(bookUrl));
  return {
    name: legado.dom.text(legado.dom.select(doc, 'h1')),
    author: legado.dom.text(legado.dom.select(doc, '.author')),
    coverUrl: legado.dom.attr(legado.dom.select(doc, '.cover img'), 'src'),
    intro: legado.dom.text(legado.dom.select(doc, '.intro')),
    lastUpdate: '',
  };
}

async function chapterList(bookUrl) {
  const doc = legado.dom.parse(await legado.http.get(bookUrl));
  return legado.dom.selectAll(doc, '.chapter-list a').map((a) => ({
    name: legado.dom.text(a),
    url: legado.dom.attr(a, 'href'),
  }));
}

async function chapterContent(chapterUrl) {
  const doc = legado.dom.parse(await legado.http.get(chapterUrl));
  return legado.dom.text(legado.dom.select(doc, '.content'));
}
```

## 5. TVbox JSON 视频源

分类页支持直接导入 TVbox 格式 JSON（含 `sites` 数组），系统自动为每个站点生成等效连接器（`ac=videolist/detail` 接口规范）。

## 6. 导入方式

分类页 → 导入连接器：
- 从文件导入（.js / .json / .txt，可多选）
- 粘贴代码导入
- 从 URL 导入

导入前会自动校验声明头与 4 个必需函数；分类页内置「连接器测试工具」可逐步验证 search → chapterList → chapterContent。
