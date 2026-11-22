// The automatic quality scaler (src/quality.js) fed with simulated frame times: no browser needed.
// usage: node tests/quality.test.mjs
import { QualityScaler, HIGH, Q } from '../src/quality.js';
import { check } from './helpers.mjs';

const results = [];
// feed `sec` seconds of frames from fn(t) (ms per frame); returns the level changes seen
function run(q, sec, fn) {
  const ch = []; let t = 0;
  while (t < sec) { const ms = fn(t); t += ms / 1000; const l = q.sample(ms); if (l >= 0) ch.push(l); }
  return ch;
}
const jitter = (base, amp) => () => base + (Math.random() - 0.5) * amp;

{ // a phone at a steady 60 fps on its start level climbs to high, one level at a time, never faster than upAfter windows
  const q = new QualityScaler(2);
  const ch = run(q, 60, jitter(16.7, 2));
  check(q.level === HIGH && ch.join() === '3,4', `steady 60 fps: 2 -> ${ch.join(' -> ')} (ends at high)`, results);
  const firstUp = q.history[0].t;
  check(firstUp >= Q.window * Q.upAfter - 0.1, `first step up only after ${firstUp.toFixed(1)} s of smooth frames`, results);
}
{ // a slow device (30 fps) drops from high to low, one step per ~3 s
  const q = new QualityScaler(HIGH);
  const ch = run(q, 30, jitter(33, 4));
  check(q.level === 0 && ch.join() === '3,2,1,0', `30 fps: high -> ${ch.join(' -> ')}`, results);
  const gaps = q.history.slice(1).map((h, i) => h.t - q.history[i].t);
  check(gaps.every((g) => g >= Q.coolDown - 0.01), `steps are at least ${Q.coolDown} s apart (${gaps.map((g) => g.toFixed(1)).join(', ')})`, results);
}
{ // a device that manages med smoothly but not med+: settles at med, no oscillation
  const q = new QualityScaler(2);
  const cost = [10, 12, 15, 26, 34]; // ms per frame at each level
  const ch = run(q, 180, () => Math.max(16.7, cost[q.level] + (Math.random() - 0.5) * 2));
  check(q.level === 2 && ch.length <= 2, `capable of med only: ${ch.join(' -> ') || 'no change'}, settles at ${q.level} (ceiling ${q.ceiling})`, results);
}
{ // occasional hitches (GC, loading) are ignored; a short slow patch shorter than downAfter windows does not step down
  const q = new QualityScaler(HIGH);
  let n = 0;
  const ch = run(q, 40, () => (++n % 200 === 0 ? 400 : n % 500 < 30 ? 30 : 16.7));
  check(ch.length === 0 && q.level === HIGH, `hitches and a 1 s slow patch: no change (${ch.join() || 'none'})`, results);
}
{ // fixed (?quality=high) never moves
  const q = new QualityScaler(HIGH, true);
  const ch = run(q, 30, jitter(80, 10));
  check(ch.length === 0 && q.level === HIGH, 'fixed level: 12 fps for 30 s, no change', results);
}
{ // recovery: slow at first (e.g. shader compiles, thermal), then smooth: comes back up, at most to the ceiling
  const q = new QualityScaler(HIGH);
  run(q, 12, jitter(30, 4));
  const low = q.level;
  run(q, 120, () => 16.7);
  check(low < HIGH && q.level > low, `slow then smooth: dropped to ${low}, recovered to ${q.level} (ceiling ${q.ceiling})`, results);
}
console.log(results.join('\n'));
