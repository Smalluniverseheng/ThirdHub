
const puppeteer = require('puppeteer-core');
(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edge, headless: 'new',
    args: ['--no-first-run', '--disable-gpu', '--no-sandbox'],
    userDataDir: process.env.TEMP + '/edge-pptr2'
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('http://127.0.0.1:8099/?noob=1', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => document.querySelector('#tabbar .tab[data-tab="profile"]').click());
  await new Promise(r => setTimeout(r, 3000));
  console.log('active:', await page.evaluate(() => document.querySelector('.page.active')?.id || 'NONE'));
  console.log('user-card:', await page.evaluate(() => !!document.querySelector('.user-card')));
  console.log('data section items:', await page.evaluate(() => document.querySelectorAll('[data-role="data"] .list-item').length));
  console.log('nav manager entry:', await page.evaluate(() => !!document.querySelector('[data-a="tabs"]')));
  // test tab manager dialog
  await page.evaluate(() => document.querySelector('[data-a="tabs"]').click());
  await new Promise(r => setTimeout(r, 1500));
  console.log('tab mgr chips:', await page.evaluate(() => [...document.querySelectorAll('.modal .ai-chip')].map(x => x.textContent).join('|')));
  console.log('errors:', errors.length ? errors.join('\n') : '(none)');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
