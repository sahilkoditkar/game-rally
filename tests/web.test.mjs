// Web build (the repository as served by GitHub Pages): menu -> race -> finish, saves in localStorage,
// no console / page errors, no request to any CrazyGames host.  usage: node tests/web.test.mjs [dir] [port]
import { chromium, serve, watch, until, finishRun, check } from './helpers.mjs';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[3] || 8471);
const results = [];
const srv = await serve(dir, port);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const w = watch(page);
  await page.goto(srv.url + '?stage=larch');
  await until(page, () => window.__game && window.__game.state === 'menu', null, 120_000, 'menu');
  check(await page.evaluate(() => !document.getElementById('adVeil')), 'no ad veil on web', results);
  await page.click('#startBtn');
  await until(page, () => window.__game.state === 'countdown' || window.__game.state === 'race', null, 60_000, 'countdown');
  await page.keyboard.press('Escape');
  check((await page.evaluate(() => window.__game.state)) === 'paused', 'Esc pauses', results);
  await page.keyboard.press('Escape');
  await finishRun(page);
  const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  check(!!ls['dustline.best.larch'], 'best time saved in localStorage', results);
  check(!!ls['dustline.profile'] && JSON.parse(ls['dustline.profile']).stats.runs === 1, 'profile saved in localStorage (1 run)', results);
  check(!Object.keys(ls).some((k) => k.includes('__')), 'no platform bookkeeping keys on web', results);
  // Retry is instant on web (no break, no veil)
  await page.keyboard.press('Enter');
  await until(page, () => window.__game.state === 'countdown', null, 30_000, 'retry countdown');
  check(await page.evaluate(() => !window.__game.adBreak && !document.getElementById('adVeil')), 'retry: no ad break on web', results);
  await page.keyboard.press('Escape'); await page.click('#pMenuBtn');
  await until(page, () => window.__game.state === 'menu', null, 30_000, 'menu again');
  const plat = await page.evaluate(() => ({ name: window.__platform && window.__platform.name, log: window.__platform && window.__platform.log }));
  check(plat.name === 'web', 'platform is web', results);
  console.log('platform log:', (plat.log || []).join(' '));
  const cg = w.requests.filter((u) => /crazygames/i.test(u));
  check(cg.length === 0, 'no request to a CrazyGames host', results);
  check(w.requests.every((u) => u.startsWith(srv.url)), 'every request is same-origin (' + w.requests.length + ' requests)', results);
  check(w.errors.length === 0, 'no console/page errors' + (w.errors.length ? ': ' + w.errors.join(' | ') : ''), results);
  console.log('localStorage keys:', Object.keys(ls).join(', '));
} finally {
  await browser.close(); srv.stop();
  console.log(results.join('\n'));
}
