/* tools/regression.cjs — 无头回归：线上首页 + AI/我的模块加载 + 零控制台错误 */
const puppeteer = require('D:/ai/deep seek/node_modules/puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=430,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto('https://thirdhub.pages.dev/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button, .btn, a')).find((x) => /先看看|开始体验/.test(x.textContent || '')); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button, .btn, a, [class*=skip]')).find((x) => /跳过/.test(x.textContent || '')); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 2500));
  for (const t of ['ai', 'profile']) {
    await page.evaluate((tt) => { const el = document.querySelector('[data-tab="' + tt + '"]'); if (el) el.click(); }, t);
    await new Promise((r) => setTimeout(r, 3000));
    const fail = await page.evaluate(() => document.body.innerText.includes('加载失败'));
    if (fail) errors.push('模块 ' + t + ' 加载失败');
  }
  await browser.close();
  if (errors.length) { console.error('回归失败: ' + errors.join(' | ')); process.exit(1); }
  console.log('回归通过: 首页/AI/我的 均正常,零错误');
})().catch((e) => { console.error('回归异常: ' + e.message); process.exit(1); });