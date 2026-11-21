// CrazyGames build, run from the unzipped dist/dustline-crazygames.zip with the SDK URL served by tests/cg-sdk-mock.js.
// usage: node tests/crazygames.test.mjs <unzipped dir> [port]
import { readFileSync } from 'node:fs';
import { chromium, serve, watch, until, finishRun, check, sleep } from './helpers.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tests/crazygames.test.mjs <unzipped build dir> [port]'); process.exit(1); }
const port = Number(process.argv[3] || 8473);
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const MOCK = readFileSync(new URL('./cg-sdk-mock.js', import.meta.url), 'utf8');
const results = [];
const srv = await serve(dir, port);
const browser = await chromium.launch();
const EXPECTED_NOISE = /Failed to load resource|ERR_FAILED|ERR_BLOCKED/;

// game.* / ad.* / init calls since index `from`
const calls = (page, from = 0) => page.evaluate((f) => window.__cgCalls.slice(f).filter((c) => /^(init|game\.|ad\.)/.test(c) && c !== 'game.happytime'), from);
const callCount = (page) => page.evaluate(() => window.__cgCalls.length);
const veilOn = (page) => page.evaluate(() => { const v = document.getElementById('adVeil'); return !!v && getComputedStyle(v).display !== 'none'; });

async function context(cfg, { block = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  await ctx.addInitScript((c) => { window.__cgMockConfig = c.cfg; window.__DUSTLINE_AD_POLICY = c.policy; }, { cfg, policy: { minGapMs: 0, skipRuns: 1, requestTimeoutMs: 3000 } });
  await ctx.route(SDK_URL, (r) => (block ? r.abort('blockedbyclient') : r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK })));
  return ctx;
}

try {
  // ------------------------------------------------------------------ full session with the SDK
  {
    const ctx = await context({ env: 'crazygames', ads: ['finish', 'error', 'hang', 'finish'] });
    const page = await ctx.newPage();
    const w = watch(page);
    // a returning GitHub-Pages-era player: saves already in localStorage (seeded once, before the first boot)
    await page.goto(srv.url + 'style.css');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('dustline.profile', JSON.stringify({ v: 1, credits: 777, build: {}, owned: { parts: [], paints: [], accents: [] }, stats: { runs: 5, earned: 777, dailyDone: '' } }));
      localStorage.setItem('dustline.best.mesa', JSON.stringify({ t: 99.5, s: [30, 60] }));
      localStorage.setItem('unrelated.key', '1');
    });
    await page.goto(srv.url + '?stage=larch');
    await until(page, () => window.__game && window.__game.state === 'menu', null, 120_000, 'menu');
    let seq = await calls(page);
    check(JSON.stringify(seq) === JSON.stringify(['init', 'ad.hasAdblock', 'game.loadingStart', 'game.addSettingsChangeListener', 'game.loadingStop']), 'boot: ' + seq.join(' > '), results);
    const mig = await page.evaluate(() => ({ profile: JSON.parse(localStorage.getItem('cgmock:dustline.profile') || 'null'), best: localStorage.getItem('cgmock:dustline.best.mesa'), unrelated: localStorage.getItem('cgmock:unrelated.key'), flag: localStorage.getItem('cgmock:dustline.__migrated'), credits: window.__game.profile.credits }));
    check(mig.profile && mig.profile.credits === 777 && !!mig.best && !mig.unrelated && !!mig.flag, 'migration copied dustline.* localStorage keys into the Data module (only those)', results);
    check(mig.credits === 777, 'game reads the migrated profile (777 CR)', results);

    // --- stage 1: start, pause, resume, finish
    let n = await callCount(page);
    await page.click('#startBtn');
    await until(page, () => window.__game.state === 'race', null, 120_000, 'race');
    await page.keyboard.press('Escape');
    check((await page.evaluate(() => window.__game.state)) === 'paused', 'Esc pauses', results);
    await page.keyboard.press('Escape');
    await finishRun(page);
    seq = await calls(page, n);
    check(JSON.stringify(seq) === JSON.stringify(['game.gameplayStart', 'game.gameplayStop', 'game.gameplayStart', 'game.gameplayStop']), 'stage 1 start/pause/resume/finish: ' + seq.join(' > '), results);
    const saved = await page.evaluate(() => ({ best: localStorage.getItem('cgmock:dustline.best.larch'), runs: JSON.parse(localStorage.getItem('cgmock:dustline.profile')).stats.runs }));
    check(!!saved.best && saved.runs === 6, 'finish saved through the Data module (best + profile)', results);

    // --- Next after the session's first run: no break (skipRuns)
    n = await callCount(page);
    await page.keyboard.press('KeyN');
    await until(page, () => window.__game.state === 'countdown', null, 60_000, 'countdown 2');
    check(!(await page.evaluate(() => window.__game.adBreak)), 'first run of the session: no ad break', results);
    await finishRun(page);
    seq = await calls(page, n);
    check(JSON.stringify(seq) === JSON.stringify(['game.gameplayStart', 'game.gameplayStop']), 'stage 2: ' + seq.join(' > '), results);

    // --- Next: a midgame ad that finishes
    n = await callCount(page);
    await page.keyboard.press('KeyN');
    await until(page, () => window.__game.adBreak, null, 5000, 'ad break');
    await sleep(400);
    const during = await page.evaluate(() => ({ st: window.__game.state, muted: window.__game.audioMuted, cd: window.__game.time }));
    check(during.st === 'finish' && during.muted === true, 'during ad: still on the result panel, audio muted', results);
    check(await veilOn(page), 'during ad: "Back in a moment" veil shown', results);
    await page.keyboard.press('Enter'); await page.keyboard.press('KeyN'); await page.mouse.click(240, 135);
    check((await page.evaluate(() => window.__game.screen)) === 'finish', 'during ad: input swallowed', results);
    await until(page, () => !window.__game.adBreak, null, 10_000, 'ad over');
    check(await page.evaluate(() => window.__game.audioMuted === false && window.__game.state === 'countdown'), 'after adFinished: unmuted, next stage counting down', results);
    check(!(await veilOn(page)), 'veil gone', results);
    await finishRun(page);
    seq = await calls(page, n);
    check(JSON.stringify(seq) === JSON.stringify(['ad.requestAd:midgame:finish', 'game.gameplayStart', 'game.gameplayStop']), 'next + ad(finished): ' + seq.join(' > '), results);

    // --- player mutes (M), Retry: ad errors; the player's own mute survives the break
    await page.keyboard.press('KeyM');
    check(await page.evaluate(() => window.__game.muted && window.__game.audioMuted), 'player muted with M', results);
    n = await callCount(page);
    await page.keyboard.press('Enter');
    await until(page, () => window.__game.state === 'countdown', null, 10_000, 'retry after adError');
    check(await page.evaluate(() => window.__game.audioMuted === true), 'after adError: player mute kept', results);
    await page.keyboard.press('KeyM');
    await finishRun(page);
    seq = await calls(page, n);
    check(JSON.stringify(seq) === JSON.stringify(['ad.requestAd:midgame:error', 'game.gameplayStart', 'game.gameplayStop']), 'retry + ad(error): ' + seq.join(' > '), results);

    // --- Retry: an ad that never calls back -> timeout guard resumes
    n = await callCount(page);
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    await until(page, () => window.__game.adBreak, null, 5000, 'hanging ad');
    await until(page, () => window.__game.state === 'countdown', null, 15_000, 'timeout resume');
    const waited = Date.now() - t0;
    check(waited >= 2500 && waited < 9000, `never-returning ad: resumed by the timeout after ${waited} ms`, results);
    check(await page.evaluate(() => !window.__game.adBreak && window.__game.audioMuted === false), 'after timeout: unmuted', results);
    await until(page, () => window.__game.state === 'race', null, 60_000, 'race');
    await page.keyboard.press('Escape');
    await page.click('#pMenuBtn');
    await until(page, () => window.__game.state === 'menu', null, 30_000, 'menu');
    seq = await calls(page, n);
    check(JSON.stringify(seq) === JSON.stringify(['ad.requestAd:midgame:hang', 'game.gameplayStart', 'game.gameplayStop']), 'retry + ad(hang) + pause + quit: ' + seq.join(' > '), results);

    // --- portal mute (settings.muteAudio) wins over the in-game setting
    await page.evaluate(() => window.__cgSetMute(true));
    check(await page.evaluate(() => window.__game.audioMuted === true && window.__game.muted === false), 'settings.muteAudio=true mutes (player setting untouched)', results);
    await page.evaluate(() => window.__cgSetMute(false));
    check(await page.evaluate(() => window.__game.audioMuted === false), 'settings.muteAudio=false restores sound', results);

    // --- rally: stage 1 -> interstitial -> Continue (ad) -> stage 2 -> interstitial -> Abandon -> menu
    n = await callCount(page);
    await page.evaluate(() => window.__game.selectEntry('forest', 'rally'));
    await page.click('#startBtn');
    await finishRun(page);
    check((await page.evaluate(() => window.__game.screen)) === 'rallyinter', 'rally interstitial shown', results);
    await page.click('#rally [data-act=continue]');
    await until(page, () => window.__game.adBreak, null, 5000, 'rally ad');
    check(await page.evaluate(() => window.__game.audioMuted), 'rally ad: muted', results);
    await until(page, () => window.__game.state === 'countdown', null, 10_000, 'rally stage 2');
    await finishRun(page);
    await page.click('#rally [data-act=abandon]');
    await until(page, () => window.__game.state === 'menu', null, 30_000, 'menu after rally');
    seq = await calls(page, n);
    check(JSON.stringify(seq) === JSON.stringify(['game.gameplayStart', 'game.gameplayStop', 'ad.requestAd:midgame:finish', 'game.gameplayStart', 'game.gameplayStop']), 'rally: ' + seq.join(' > '), results);
    const happy = await page.evaluate(() => window.__cgCalls.filter((c) => c === 'game.happytime').length);
    console.log('happytime calls this session:', happy);

    // --- reload: Data module is the source of truth, migration does not run again
    const before = await page.evaluate(() => ({ flag: localStorage.getItem('cgmock:dustline.__migrated'), runs: JSON.parse(localStorage.getItem('cgmock:dustline.profile')).stats.runs }));
    await page.evaluate(() => localStorage.setItem('dustline.best.frost', JSON.stringify({ t: 1, s: [] }))); // a local-only key appearing later
    await page.reload();
    await until(page, () => window.__game && window.__game.state === 'menu', null, 120_000, 'menu after reload');
    const after = await page.evaluate(() => ({ flag: localStorage.getItem('cgmock:dustline.__migrated'), runs: window.__game.profile.stats.runs, frost: localStorage.getItem('cgmock:dustline.best.frost'), sets: window.__cgCalls.filter((c) => c === 'data.setItem:dustline.__migrated').length }));
    check(after.flag === before.flag && after.sets === 0 && !after.frost, 'reload: migration ran once only', results);
    check(after.runs === before.runs, `reload: profile from the Data module (${after.runs} runs)`, results);
    check(w.errors.length === 0, 'no console/page errors' + (w.errors.length ? ': ' + w.errors.join(' | ') : ''), results);
    await ctx.close();
  }

  // ------------------------------------------------------------------ SDK blocked (ad-blocker)
  {
    const ctx = await context({}, { block: true });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(srv.url + '?stage=larch');
    await until(page, () => window.__game && window.__game.state === 'menu', null, 120_000, 'menu (blocked)');
    await page.click('#startBtn');
    await finishRun(page);
    await page.keyboard.press('KeyN'); // runs: 1 -> no break anyway; then a second finish and Next would try
    await finishRun(page);
    await page.keyboard.press('KeyN');
    await until(page, () => window.__game.state === 'countdown', null, 10_000, 'next (blocked)');
    const r = await page.evaluate(() => ({ best: localStorage.getItem('dustline.best.larch'), cg: Object.keys(localStorage).filter((k) => k.startsWith('cgmock:')).length, sdk: !!window.CrazyGames, adBreak: window.__game.adBreak }));
    check(!r.sdk && !!r.best && r.cg === 0, 'SDK blocked: game starts, plays and saves to localStorage', results);
    check(!r.adBreak && !(await page.evaluate(() => !!document.getElementById('adVeil'))), 'SDK blocked: no ad break attempted', results);
    check(w.warnings.some((x) => x.includes('running without the SDK')), 'SDK blocked: one clear console warning', results);
    const errs = w.errors.filter((e) => !EXPECTED_NOISE.test(e));
    check(errs.length === 0, 'SDK blocked: no errors besides the blocked request' + (errs.length ? ': ' + errs.join(' | ') : ''), results);
    await ctx.close();
  }

  // ------------------------------------------------------------------ init failure, disabled environment
  for (const [label, cfg] of [['init() rejects', { initFail: true }], ['environment disabled', { env: 'disabled' }]]) {
    const ctx = await context(cfg);
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(srv.url + '?stage=larch');
    await until(page, () => window.__game && window.__game.state === 'menu', null, 120_000, 'menu: ' + label);
    const c = await page.evaluate(() => window.__cgCalls.filter((x) => x !== 'init'));
    check(c.length === 0 && w.errors.length === 0, `${label}: menu reached, no further SDK calls, no errors`, results);
    await ctx.close();
  }
} finally {
  await browser.close(); srv.stop();
  console.log(results.join('\n'));
}
