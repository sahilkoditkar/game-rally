// Small shared helpers: DOM lookup, URL params, maths, time formatting.
export const $ = (id) => document.getElementById(id);
export const params = new URLSearchParams(location.search);

export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export function fmt(t) {
  if (!(t >= 0)) return '-:--.---';
  const ms = Math.floor(t * 1000), m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
export const fmtDelta = (d) => (d < 0 ? '−' : '+') + Math.abs(d).toFixed(3);
export const deltaClass = (d) => (d == null ? 'd-none' : d < 0 ? 'd-good' : 'd-bad');
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
