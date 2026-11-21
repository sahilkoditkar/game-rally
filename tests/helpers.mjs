// Shared helpers for the headless platform tests (Playwright + http-server, nothing installed in the repo).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export async function serve(dir, port) {
  const url = `http://127.0.0.1:${port}/`;
  try { await fetch(url); throw new Error(`port ${port} is already in use`); } catch (e) { if (/in use/.test(e.message)) throw e; }
  // its own process group, so stop() also ends the http-server that npx starts
  const p = spawn('npx', ['-y', 'http-server', dir, '-p', String(port), '-c-1', '-s'], { stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-p.pid); } catch { /* gone */ } };
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return { url, stop }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  stop(); throw new Error('server did not start: ' + dir);
}

// collects console errors, page errors and every requested URL
export function watch(page) {
  const w = { errors: [], warnings: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') w.errors.push(m.text()); if (m.type() === 'warning') w.warnings.push(m.text()); });
  page.on('pageerror', (e) => w.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => w.requests.push(r.url()));
  return w;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(page, fn, arg, timeout = 120_000, what = String(fn)) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); } catch (e) { throw new Error('timed out waiting for ' + what); }
}
export const state = (page) => page.evaluate(() => window.__game && window.__game.state);
export const screen = (page) => page.evaluate(() => window.__game && window.__game.screen);

// drive a solo run to its result panel: autopilot from just before the finish line (gates skipped = penalties)
export async function finishRun(page) {
  await until(page, () => window.__game.state === 'race', null, 120_000, 'race');
  await page.evaluate(() => { const g = window.__game; g.setAuto(true); g.car.reset(g.stage, g.stage.finishIdx - 25); });
  await until(page, () => window.__game.state === 'finish', null, 120_000, 'finish');
  await until(page, () => ['finish', 'duelres', 'rallyinter', 'rallyfinal'].includes(window.__game.screen), null, 60_000, 'result panel');
  await page.evaluate(() => window.__game.setAuto(false));
  await sleep(500); // the panels ignore presses for 400 ms
}

export function check(cond, msg, results) {
  results.push((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) process.exitCode = 1;
}
