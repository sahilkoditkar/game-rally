// Roving focus for overlay panels (pause, results, rally): up / down or the d-pad move a highlight between the
// panel's visible buttons, Enter / A press the highlighted one. The primary button is highlighted by default.
// The highlight is the .kfocus class (drawn as the mustard focus ring once keyboard or pad navigation is used).
export const navBtns = (root) => [...root.querySelectorAll('.btn')].filter((b) => !b.disabled && !b.classList.contains('hidden') && b.offsetParent !== null);
function setFocus(root, b) {
  for (const x of root.querySelectorAll('.kfocus')) x.classList.remove('kfocus');
  if (b) b.classList.add('kfocus');
}
export function defaultFocus(root) {
  const bs = navBtns(root);
  setFocus(root, bs.find((b) => b.classList.contains('primary')) || bs[0]);
}
export function moveFocus(root, dir) {
  const bs = navBtns(root);
  if (!bs.length) return;
  const i = bs.findIndex((b) => b.classList.contains('kfocus'));
  setFocus(root, bs[i < 0 ? 0 : (i + dir + bs.length) % bs.length]);
}
export function activateFocus(root) {
  const bs = navBtns(root);
  const b = bs.find((x) => x.classList.contains('kfocus')) || bs.find((x) => x.classList.contains('primary')) || bs[0];
  if (b) b.click();
}
