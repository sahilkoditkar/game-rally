// Keyboard, gamepad and touch input. Turning these into game actions is main.js's job.
import { clamp } from './track.js';

export const keys = new Set();
export const touchState = { left: false, right: false, gas: false, brake: false, hand: false };
const mkPad = () => ({ steer: 0, throttle: 0, brake: 0, hand: false, btn: [] });
export const pads = [mkPad(), mkPad()];
export const HOLD = { steer: 0, throttle: 0, brake: 0, hand: true }; // brake>0 at rest would engage reverse

const KEYSETS = {
  solo: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], hand: ['Space'] },
  p1: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], hand: ['ShiftLeft', 'Space'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], hand: ['ShiftRight', 'Enter', 'NumpadEnter'] },
};

// solo: both key sets + touch + first pad drive the one car; duel: WASD/pad 0 -> P1, arrows/pad 1 -> P2
export function readInput(i, solo) {
  const ks = solo ? KEYSETS.solo : i ? KEYSETS.p2 : KEYSETS.p1, pad = pads[solo ? 0 : i];
  const k = (arr) => arr.some((x) => keys.has(x));
  let steer = (k(ks.left) ? 1 : 0) - (k(ks.right) ? 1 : 0) + pad.steer;
  if (solo) steer += (touchState.left ? 1 : 0) - (touchState.right ? 1 : 0);
  return {
    steer: clamp(steer, -1, 1),
    throttle: Math.max(k(ks.up) ? 1 : 0, solo && touchState.gas ? 1 : 0, pad.throttle),
    brake: Math.max(k(ks.down) ? 1 : 0, solo && touchState.brake ? 1 : 0, pad.brake),
    hand: k(ks.hand) || (solo && touchState.hand) || pad.hand,
  };
}

export const connectedPads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((g) => g && g.connected);

// poll pads once per frame; onEdge(padIndex, buttonIndex) fires on newly pressed buttons
export function pollPads(onEdge) {
  const list = connectedPads();
  for (let k = 0; k < 2; k++) {
    const pad = pads[k], gp = list[k];
    if (!gp) { pad.steer = pad.throttle = pad.brake = 0; pad.hand = false; pad.btn = []; continue; }
    const ax = gp.axes[0] || 0, b = (i) => gp.buttons[i] || { value: 0, pressed: false };
    pad.steer = Math.abs(ax) > 0.15 ? -Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85 : 0;
    pad.throttle = b(7).value; pad.brake = b(6).value; pad.hand = b(0).pressed;
    const was = pad.btn; pad.btn = gp.buttons.map((x) => x.pressed);
    pad.btn.forEach((on, i) => { if (on && !was[i]) onEdge(k, i); });
  }
}

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Backspace']);
// onKey(e) is called for fresh (non-repeat) key presses not aimed at a focused button's Enter
export function bindKeyboard(onKey) {
  window.addEventListener('keydown', (e) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    const onBtn = e.target && e.target.closest && e.target.closest('button');
    if (onBtn && (e.code === 'Enter' || e.code === 'NumpadEnter')) return; // let the focused button act
    keys.add(e.code);
    if (!e.repeat) onKey(e);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); for (const k in touchState) touchState[k] = false; });
}

// touch (solo only): each control tracks its own set of pointers, so multi-touch works
export function bindTouch(root, { onPress, onReset }) {
  for (const el of root.querySelectorAll('[data-ctl]')) {
    const ctl = el.dataset.ctl, ids = new Set();
    const sync = () => { const on = ids.size > 0; el.classList.toggle('on', on); if (ctl in touchState) touchState[ctl] = on; };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); onPress();
      ids.add(e.pointerId); sync();
      if (ctl === 'reset') onReset();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => { ids.delete(e.pointerId); sync(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
