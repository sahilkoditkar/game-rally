// The game inside a cross-origin iframe on a long, scrollable parent page (like a portal's game page):
// click focuses it, game keys never scroll the parent, the canvas follows iframe resizes, no errors.
// usage: node tests/iframe.test.mjs [game dir] [port]
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, serve, watch, until, check, sleep } from './helpers.mjs';

const dir = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[3] || 8475);
const results = [];
const game = await serve(dir, port);
const parentDir = mkdtempSync(join(tmpdir(), 'dustline-parent-'));
const SIZES = [[800, 450], [1280, 720], [360, 640]];
const filler = Array.from({ length: 80 }, (_, i) => `<p>Portal page paragraph ${i + 1}: other games, comments, footer links.</p>`).join('');
writeFileSync(join(parentDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>parent</title>
<body style="margin:0;font:14px sans-serif">${filler.split("</p>").slice(0, 12).join("</p>")}</p>
<iframe id="g" src="${game.url.replace('127.0.0.1', 'localhost')}?stage=larch" style="border:0;display:block" allow="autoplay; fullscreen; gamepad"></iframe>
${filler}</body>`);
const parent = await serve(parentDir, port + 1);
const browser = await chromium.launch();
try {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: Math.max(w + 40, 400), height: 900 } });
    const wp = watch(page);
    await page.goto(parent.url);
    await page.evaluate(([w, h]) => { const f = document.getElementById('g'); f.style.width = w + 'px'; f.style.height = h + 'px'; }, [w, h]);
    let frame = null; // a cross-origin iframe gets its own Frame once it has navigated
    for (let i = 0; i < 300 && !frame; i++) { frame = page.frames().find((f) => f.url().includes(':' + port + '/')); if (!frame) await sleep(100); }
    await until(frame, () => window.__game && window.__game.state === 'menu', null, 120_000, 'menu in iframe');
    // put the iframe in view and remember the parent scroll position
    await page.evaluate(() => { const f = document.getElementById('g'); window.scrollTo(0, f.offsetTop - 10); });
    const y0 = await page.evaluate(() => window.scrollY);
    const box = await (await page.$('#g')).boundingBox();
    await page.mouse.click(box.x + 8, box.y + box.height / 2); // a click on the canvas edge, away from the menu sheet
    const focused = await frame.evaluate(() => document.hasFocus());
    check(focused, `${w}x${h}: clicking the game focuses the iframe`, results);
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowDown', 'Space', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(k);
    let y1 = await page.evaluate(() => window.scrollY);
    check(y1 === y0, `${w}x${h}: menu keys do not scroll the parent (${y0} -> ${y1})`, results);
    // race: hold the arrows and space
    await frame.evaluate(() => window.__game.startStage('larch'));
    await until(frame, () => window.__game.state === 'race', null, 120_000, 'race in iframe');
    await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowLeft'); await page.keyboard.press('Space');
    await sleep(1500);
    await page.keyboard.up('ArrowLeft'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('ArrowUp');
    y1 = await page.evaluate(() => window.scrollY);
    const moved = await frame.evaluate(() => window.__game.car.speed);
    check(y1 === y0 && moved > 0.5, `${w}x${h}: driving keys reach the game (speed ${moved.toFixed(1)}) and do not scroll the parent`, results);
    for (const k of ['PageDown', 'End', 'PageUp', 'Home']) await page.keyboard.press(k);
    y1 = await page.evaluate(() => window.scrollY);
    check(y1 === y0, `${w}x${h}: PageUp/PageDown/Home/End do not scroll the parent (${y0} -> ${y1})`, results);
    // resize the iframe: the renderer follows
    await page.evaluate(([w, h]) => { const f = document.getElementById('g'); f.style.width = Math.round(h * 1.2) + 'px'; f.style.height = Math.round(w * 0.6) + 'px'; }, [w, h]);
    await sleep(800);
    const sz = await frame.evaluate(() => { const c = document.querySelector('#app canvas'); return { cw: c.clientWidth, ch: c.clientHeight, iw: innerWidth, ih: innerHeight }; });
    check(sz.cw === sz.iw && sz.ch === sz.ih && sz.iw === Math.round(h * 1.2), `${w}x${h}: canvas follows an iframe resize (${sz.cw}x${sz.ch})`, results);
    check(wp.errors.length === 0, `${w}x${h}: no console/page errors` + (wp.errors.length ? ': ' + wp.errors.join(' | ') : ''), results);
    await page.close();
  }
} finally {
  await browser.close(); game.stop(); parent.stop();
  console.log(results.join('\n'));
}
