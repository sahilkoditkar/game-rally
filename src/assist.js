// Auto accelerate (a driving assist, mainly for touch): the car applies the throttle by itself, the player steers,
// brakes and can use the handbrake. It works on the input only (the car's physics are untouched):
// - throttle = 1 unless the player brakes; braking past a stop still reverses, as with a held BRAKE
// - before a tight corner it lifts off (and only then, gently, brakes) so a player who only steers can make the turn.
//   It aims at a cautious corner speed (well under what the reference autopilot carries), so it never gives
//   anything a player couldn't do themselves: no time bonus, same physics, gates, penalties, ghosts and medals.
export const AUTOGAS_KEY = 'dustline.autogas';

const GRIP = 10.5;          // car.js lateral grip (m/s^2 at grip 1); the assist plans with a margin under it
export const ASSIST = {
  margin: 0.62,             // fraction of the grip limit the assist plans its corner speeds with
  dec: 5.5,                 // m/s^2 of slowing it allows for between here and a corner (lift + light brake)
  ahead: 70,                // m of road it looks at (plus 1.6 s at the current speed)
  brakeOver: 2.5,           // m/s over the planned speed before it adds a light brake
  brakeMax: 0.45,           // never more than this much brake
  vMin: 9,                  // m/s: it never plans slower than this (keeps the car rolling)
};

const STEP = 2;
// cautious speed the car should have now, from the curvature of the road ahead
export function plannedSpeed(car, stage) {
  const K = car.H || { grip: 1 };
  const lat = GRIP * (K.grip || 1) * ((stage.def && stage.def.grip) || 1) * ASSIST.margin;
  const n = stage.n, i0 = Math.max(0, Math.min(n - 1, car.idx | 0));
  const span = Math.round((ASSIST.ahead + Math.max(0, car.speed) * 1.6) / STEP);
  let vT = 70;
  for (let k = 0; k <= span; k++) {
    const i = Math.min(n - 1, i0 + k), c = Math.abs(stage.curv[i]);
    if (c < 1e-4) continue;
    const vc = Math.sqrt(lat / c), v = Math.sqrt(vc * vc + 2 * ASSIST.dec * k * STEP);
    if (v < vT) vT = v;
  }
  return Math.max(ASSIST.vMin, vT);
}

// input: { steer, throttle, brake, hand } from the player; returns the input the car gets
export function autoGas(input, car, stage) {
  if (input.brake > 0.05) return input; // the player's brake wins (and reverses at a stop)
  let throttle = 1, brake = 0;
  const vf = car.vf != null ? car.vf : car.speed;
  if (stage && stage.curv && vf > 2 && car.grounded !== false) {
    const vT = plannedSpeed(car, stage);
    if (vf > vT) throttle = Math.max(0, 1 - (vf - vT) * 0.5);
    if (vf > vT + ASSIST.brakeOver) brake = Math.min(ASSIST.brakeMax, (vf - vT - ASSIST.brakeOver) * 0.12);
  }
  return { ...input, throttle: Math.max(input.throttle || 0, brake > 0 ? 0 : throttle), brake };
}
