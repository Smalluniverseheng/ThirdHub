
const puppeteer = require('puppeteer-core');
(async () => {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await puppeteer.launch({ executablePath: edge, headless: 'new', args: ['--no-first-run', '--disable-gpu', '--no-sandbox'], userDataDir: process.env.TEMP + '/edge-pptr3' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8099/?noob=1', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  // go to profile
  await page.evaluate(() => document.querySelector('#tabbar .tab[data-tab="profile"]').click());
  await new Promise(r => setTimeout(r, 2500));
  console.log('hash after click:', await page.evaluate(() => location.hash));
  // reload
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  console.log('active after reload:', await page.evaluate(() => document.querySelector('.page.active')?.id || 'NONE'));
  console.log('hash after reload:', await page.evaluate(() => location.hash));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
