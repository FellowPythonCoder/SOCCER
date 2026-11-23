import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const executablePath = await chromium.executablePath();
console.log('chromium at', executablePath);
const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
  executablePath,
  headless: 'shell',
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack || '').split('\n').slice(0,8).join('\n')}`));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
const info = await page.evaluate(() => ({
  hasCanvas: !!document.querySelector('#app canvas'),
  canvasSize: (() => { const c = document.querySelector('#app canvas'); return c ? [c.width, c.height] : null; })(),
  menuHidden: (() => { const m = document.getElementById('hud-menu'); return m ? m.className : 'MISSING'; })(),
  hudPresent: !!document.querySelector('.hud'),
  game: !!window.__game,
  appChildren: document.getElementById('app').children.length,
  bodyText: document.body.innerText.slice(0, 120),
}));
console.log('INFO', JSON.stringify(info, null, 2));
console.log('LOGS:\n' + (logs.join('\n') || '(none)'));
await page.screenshot({ path: '/home/user/SOCCER/.cache/bh/boot.png' });
await browser.close();
