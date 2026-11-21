// Behaviour when the game runs inside a portal iframe (does nothing on a top-level page, e.g. GitHub Pages).
// - take keyboard focus at boot, so arrows work before the first click
// - keys whose default action is "scroll" must not scroll the PARENT page: the game page itself never scrolls,
//   so the browser hands PageUp / PageDown / Home / End to the embedding page. (Arrows, Space, / and Backspace
//   are already prevented in input.js.)
const PARENT_SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);

export function setupEmbed() {
  let framed = false;
  try { framed = window.self !== window.top; } catch { framed = true; }
  if (!framed) return false;
  try { window.focus(); } catch { /* ignore */ }
  window.addEventListener('keydown', (e) => {
    if (!PARENT_SCROLL_KEYS.has(e.code)) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    e.preventDefault();
  });
  return true;
}
