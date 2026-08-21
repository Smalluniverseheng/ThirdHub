
const puppeteer = require('puppeteer-core');
const path = require('path');
(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edge,
    headless: 'new',
    args: ['--no-first-run', '--disable-gpu', '--no-sandbox'],
    userDataDir: process.env.TEMP + '/edge-pptr'
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url().slice(0, 120)));

  await page.goto('http://127.0.0.1:8099/?noob=1', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  console.log('--- initial state ---');
  console.log('tabs:', await page.$$eval('#tabbar .tab', els => els.map(e => e.dataset.tab).join(',')));
  console.log('active page:', await page.evaluate(() => document.querySelector('.page.active')?.id || 'NONE'));

  // click profile tab
  console.log('--- clicking 我的 ---');
  const clicked = await page.evaluate(() => {
    const t = document.querySelector('#tabbar .tab[data-tab="profile"]');
    if (!t) return 'no tab found';
    t.click();
    return 'clicked';
  });
  console.log('click:', clicked);
  await new Promise(r => setTimeout(r, 3000));
  console.log('active page after click:', await page.evaluate(() => document.querySelector('.page.active')?.id || 'NONE'));
  console.log('page-profile html len:', await page.evaluate(() => document.getElementById('page-profile')?.innerHTML.length || 0));
  console.log('user-card present:', await page.evaluate(() => !!document.querySelector('.user-card')));
  console.log('profile content sample:', await page.evaluate(() => (document.getElementById('page-profile')?.textContent || '').slice(0, 120)));

  console.log('--- errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
