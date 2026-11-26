// handling.js — clean-room arcade rally handling model (dependency-free ES module)
//
// The whole model in four sentences:
//  1. Steering sets a TURN RATE: at low speed it is limited by the steering lock (kinematic),
//     at speed by a lateral-acceleration budget (turnG), so a held key gives a sensible radius at any speed.
//  2. The tyres pull the VELOCITY toward the NOSE: lateral velocity relaxes with a short time constant
//     (tyreLag) but never faster than the grip limit (grip, in g). Nose rotation the tyres cannot follow
//     becomes slip angle.
//  3. A single continuous "drift level" (0..1) blends the meaning of the steering: at 0 steering means
//     "turn this fast"; at 1 it means "hold this angle" (driftAngle) while the tyres, with driftGrip,
//     pull the path around the corner. Handbrake raises the drift level; steering into the slide with
//     throttle sustains it; releasing the steer or lifting lets it fade, so the car straightens itself.
//  4. Slip beyond the allowed window is always steered back (slipCatch), which is what makes spins
//     impossible and drifts easy to catch.
//
// Conventions: Y up; yaw = 0 faces +Z; forward = (sin yaw, cos yaw); left = (cos yaw, -sin yaw);
// positive yawRate turns LEFT. input.steer +1 = LEFT. slipAngle > 0 means the nose points left of
// the direction of travel (as in a left-hand drift).

const G = 9.81;
const WHEELBASE = 2.5;          // m
const REVERSE_MAX = 8;          // m/s (29 km/h)
const HANDBRAKE_DECEL = 3.5;    // m/s², locked rear wheels
const ROLLING = 0.5;            // m/s², coasting rolling resistance
const AERO_COAST = 1.5;         // m/s² of extra coast drag at top speed
const DRIFT_MIN_SPEED = 6;      // m/s, below this a drift fades out
const OFFROAD_GRIP_LOSS = 0.3;  // fraction of grip lost well off the road
const OFFROAD_DRAG = 4;         // m/s² extra drag well off the road
const STOP_TO_REVERSE = 0.25;   // s of brake at a standstill before reverse engages
const LIMIT_ENTRY = 2.5;        // /s drift build-up from a slide at the limit, x looseRear
const DRIVE_TRACTION = 0.75;    // share of tyre grip the driven wheels can use for acceleration
const DRIVE_WHILE_SLIDING = 0.5;// share of that still available when all grip is used sideways
const DEG = Math.PI / 180;

// One entry per slider. Every parameter does one thing.
export const PARAMS = [
  // engine & brakes
  { key: 'topSpeed',   group: 'Engine & brakes', label: 'Top speed',                 unit: 'km/h', min: 100, max: 220, step: 1 },
  { key: 'accel',      group: 'Engine & brakes', label: 'Launch acceleration',       unit: 'm/s²', min: 4,   max: 16,  step: 0.1 },
  { key: 'brakeDecel', group: 'Engine & brakes', label: 'Brake strength',            unit: 'm/s²', min: 5,   max: 20,  step: 0.5 },
  // steering
  { key: 'steerSpeed', group: 'Steering', label: 'Steer key speed (full lock per s)', unit: '/s', min: 1.5, max: 12,  step: 0.1 },
  { key: 'lock',       group: 'Steering', label: 'Steering lock (slow-speed tightness)', unit: '°', min: 15, max: 45, step: 0.5 },
  { key: 'turnG',      group: 'Steering', label: 'Turn rate at speed (cornering it asks for)', unit: 'g', min: 0.6, max: 2.2, step: 0.01 },
  { key: 'turnResp',   group: 'Steering', label: 'Turn-in response (how fast the nose obeys)', unit: '/s', min: 2, max: 25, step: 0.1 },
  // grip
  { key: 'grip',       group: 'Grip', label: 'Tyre grip (cornering it can deliver)', unit: 'g', min: 0.6, max: 2.2, step: 0.01 },
  { key: 'tyreLag',    group: 'Grip', label: 'Path lag (how slowly travel follows the nose)', unit: 's', min: 0.01, max: 0.3, step: 0.005 },
  { key: 'naturalSlip',group: 'Grip', label: 'Free slip angle before the car self-corrects', unit: '°', min: 0, max: 15, step: 0.5 },
  { key: 'slipCatch',  group: 'Grip', label: 'Slide catch (how hard extra slip is pulled back)', unit: '/s', min: 1, max: 15, step: 0.1 },
  // drift
  { key: 'driftAngle', group: 'Drift', label: 'Drift angle when steering into it', unit: '°', min: 10, max: 55, step: 0.5 },
  { key: 'neutralHold',group: 'Drift', label: 'Drift kept with steer released (angle & pull share)', unit: '', min: 0, max: 1, step: 0.01 },
  { key: 'driftGrip',  group: 'Drift', label: 'Drift pull (grip while drifting, × tyre grip)', unit: '×', min: 0.6, max: 1.5, step: 0.01 },
  { key: 'slideScrub', group: 'Drift', label: 'Speed a slide costs (scrub share)', unit: '', min: 0, max: 1, step: 0.01 },
  { key: 'driftIn',    group: 'Drift', label: 'Drift build-up rate (handbrake)', unit: '/s', min: 1, max: 15, step: 0.1 },
  { key: 'driftOut',   group: 'Drift', label: 'Drift fade rate (steer released)', unit: '/s', min: 0.5, max: 8, step: 0.1 },
  { key: 'looseRear',  group: 'Drift', label: 'Loose rear (throttle at the limit starts a drift)', unit: '', min: 0, max: 1, step: 0.01 },
];

export const PRESETS = {
  grip: {
    topSpeed: 162, accel: 9.3, brakeDecel: 12, steerSpeed: 6, lock: 32, turnG: 1.3, turnResp: 13,
    grip: 1.45, tyreLag: 0.03, naturalSlip: 2, slipCatch: 8,
    driftAngle: 24, neutralHold: 0.3, driftGrip: 1.0, slideScrub: 0.9, driftIn: 6, driftOut: 3.5, looseRear: 0,
  },
  flow: {
    topSpeed: 162, accel: 9.3, brakeDecel: 11, steerSpeed: 5.5, lock: 33, turnG: 1.45, turnResp: 12,
    grip: 1.35, tyreLag: 0.04, naturalSlip: 3.5, slipCatch: 6,
    driftAngle: 32, neutralHold: 0.5, driftGrip: 1.1, slideScrub: 0.7, driftIn: 6, driftOut: 2.5, looseRear: 0.15,
  },
  slide: {
    topSpeed: 162, accel: 9.3, brakeDecel: 10.5, steerSpeed: 5, lock: 34, turnG: 1.55, turnResp: 11,
    grip: 1.28, tyreLag: 0.05, naturalSlip: 4.5, slipCatch: 7,
    driftAngle: 40, neutralHold: 0.6, driftGrip: 1.15, slideScrub: 0.5, driftIn: 7, driftOut: 2.5, looseRear: 0.3,
  },
};

export const PRESET_INFO = {
  grip:  'Grip — planted and precise: the car goes where the nose points and only slides when you pull the handbrake.',
  flow:  'Flow (default) — sharp turn-in, small natural slides at the limit, a handbrake tap starts a drift that holds its line while you steer into it and tidies itself up when you let go.',
  slide: 'Slide — loose and lively: the tail hangs out in every corner, a big-angle drift on the handbrake (or on throttle at the limit) that keeps more angle when you let go, always pulled back.',
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
// Share of the drift (angle and pull) kept for a steering input relative to the slide direction:
// +1 into the slide -> 1, released -> neutralHold, full countersteer -> 0.
const holdShare = (p, into) => (into >= 0 ? p.neutralHold + (1 - p.neutralHold) * into : p.neutralHold * (1 + into));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createCar(params) {
  const car = {
    p: { ...PRESETS.flow, ...(params || {}) },
    x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0,
    speed: 0, vf: 0, vl: 0, slipAngle: 0, drifting: false,
    driftSide: 0,      // which way the current drift goes (+1 left, -1 right)
    drift: 0,          // continuous drift level 0..1 (the only "mode", and it is a blend)
    steer: 0,          // shaped steering -1..1
    steerVis: 0,       // front wheel angle for visuals, rad
    throttleOut: 0, brakeOut: 0,
    reverse: false, stopTimer: 0,
    pathRate: 0,       // rad/s the direction of travel is turning
    skid: 0,           // 0..1, for skid marks / dust
  };
  return car;
}

export function resetCar(car, x = 0, z = 0, yaw = 0) {
  Object.assign(car, {
    x, z, yaw, vx: 0, vz: 0, yawRate: 0, speed: 0, vf: 0, vl: 0, slipAngle: 0, drifting: false,
    drift: 0, driftSide: 0, steer: 0, steerVis: 0, throttleOut: 0, brakeOut: 0, reverse: false, stopTimer: 0, pathRate: 0, skid: 0,
  });
  return car;
}

export function stepCar(car, input, env, dt) {
  const p = car.p;
  env = env || {};
  input = input || {};
  const surf = clamp(env.grip ?? 1, 0.3, 1.5);
  const off = clamp(env.offroad ?? 0, 0, 1);
  const air = !!env.airborne;
  const slope = env.slope ?? 0;
  const gm = surf * (1 - OFFROAD_GRIP_LOSS * off);

  const steerIn = clamp(+input.steer || 0, -1, 1);
  const thr = clamp(+input.throttle || 0, 0, 1);
  const brk = clamp(+input.brake || 0, 0, 1);
  const hand = !!input.hand;

  // 1. Steering shaping: digital keys ramp in at steerSpeed, return to centre twice as fast.
  const outward = Math.abs(steerIn) > Math.abs(car.steer) && steerIn * car.steer >= 0;
  car.steer = approach(car.steer, steerIn, (outward ? p.steerSpeed : 2 * p.steerSpeed) * dt);
  car.throttleOut = thr; car.brakeOut = brk;

  let fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let lx = fz, lz = -fx;
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * lx + car.vz * lz;
  const v0 = Math.hypot(car.vx, car.vz);
  const theta0 = Math.atan2(car.vx, car.vz);

  // 2. Gear: braking at a standstill for a moment engages reverse; throttle returns to forward.
  if (!car.reverse) {
    if (brk > 0.5 && thr < 0.5 && vf < 0.5 && !air) {
      car.stopTimer += dt;
      if (car.stopTimer >= STOP_TO_REVERSE - 1e-9) car.reverse = true;
    } else car.stopTimer = 0;
  } else if (thr > 0.5 && vf > -0.5) { car.reverse = false; car.stopTimer = 0; }
  const drive = car.reverse ? -brk : thr;      // + forward, - backward
  const brakeCmd = car.reverse ? thr : brk;

  const vmax = p.topSpeed / 3.6;
  const aGrip = G * p.grip * gm;               // what the tyres can deliver, m/s²

  if (!air) {
    // 3. Lateral: tyres pull the velocity toward the nose, never harder than the grip limit.
    //    While drifting, the limit is driftGrip x grip, scaled by the steering: steering into the
    //    drift pulls the car round hardest, a released key pulls with neutralHold, a countersteer
    //    lets the car run straight on along its current path.
    const b0 = (v0 > 1 && vf > 0) ? Math.atan2(-vl, vf) : 0;
    const dir0 = Math.abs(b0) > 0.05 ? Math.sign(b0) : Math.sign(car.steer);
    const pull = Math.max(0.3, holdShare(p, car.steer * dir0));
    const aLat = aGrip * (1 + (p.driftGrip * pull - 1) * car.drift);
    const tau = p.tyreLag / surf;
    let dvl = vl * (Math.exp(-dt / tau) - 1);
    dvl = clamp(dvl, -aLat * dt, aLat * dt);

    // 4. Longitudinal, along the heading. Drive can use DRIVE_TRACTION of the tyre grip, minus what
    //    cornering is already using (friction circle), but never less than DRIVE_WHILE_SLIDING of it.
    const latUse = Math.min(1, Math.abs(dvl) / dt / aGrip);
    const driveCap = aGrip * DRIVE_TRACTION * Math.max(DRIVE_WHILE_SLIDING, Math.sqrt(1 - latUse * latUse));
    let aDrive = 0;
    if (drive > 0) aDrive = drive * p.accel * (1 - (Math.max(vf, 0) / vmax) ** 2);
    else if (drive < 0) aDrive = drive * p.accel * 0.6 * (1 - (Math.max(-vf, 0) / REVERSE_MAX) ** 2);
    aDrive = clamp(aDrive, -driveCap, driveCap);
    vf += (aDrive - G * slope) * dt;
    let aStop = brakeCmd * Math.min(p.brakeDecel, aGrip) + OFFROAD_DRAG * off * Math.min(1, Math.abs(vf) / 10);
    if (drive === 0) aStop += ROLLING + AERO_COAST * (v0 / vmax) ** 2;
    vf = approach(vf, 0, aStop * dt);

    // Part of the sideways tyre force points backwards along the travel direction (scrub).
    // slideScrub keeps that share; the rest is given back so a slide costs less speed.
    const vm = Math.hypot(vf, vl);
    if (vm > 0.1) {
      const uf = vf / vm, ul = vl / vm;
      const along = dvl * ul;                  // < 0 when the slide slows the car
      if (along < 0) { const give = -(1 - p.slideScrub) * along; vf += give * uf; vl += give * ul; }
    }
    vl += dvl;

    // 5. Handbrake: locked rear wheels drag the car along its travel direction.
    if (hand) {
      const vm2 = Math.hypot(vf, vl);
      if (vm2 > 1e-6) { const k = Math.max(0, vm2 - HANDBRAKE_DECEL * dt) / vm2; vf *= k; vl *= k; }
    }
  } else {
    const k = Math.max(0, 1 - (AERO_COAST * (v0 / vmax) ** 2) * dt / Math.max(v0, 1e-6));
    vf *= k; vl *= k;
  }

  car.vx = vf * fx + vl * lx;
  car.vz = vf * fz + vl * lz;
  const v1 = Math.hypot(car.vx, car.vz);
  car.pathRate = (v1 > 1 && v0 > 1) ? wrap(Math.atan2(car.vx, car.vz) - theta0) / dt : 0;

  // 6. Drift level: the only state beyond motion. It rises with the handbrake (or, if looseRear > 0,
  //    with throttle while the car is already sliding at the grip limit), is sustained by steering into
  //    the slide with throttle, and fades when the steer is released or countered, or on lift-off.
  const beta = (v1 > 1 && vf > 0) ? Math.atan2(-vl, vf) : 0;
  const dir = Math.abs(beta) > 0.05 ? Math.sign(beta) : Math.sign(car.steer);
  const into = car.steer * dir;                // > 0 steering into the slide, < 0 countersteering
  const moving = !car.reverse && vf > DRIFT_MIN_SPEED;
  if (!air) {
    let rise = 0;
    // A drift belongs to one side. If the slide swings to the other side, the old drift is over
    // (no pendulum): it fades, and a new one on the other side has to be started like any other.
    if (car.drift === 0 || hand) car.driftSide = dir;
    const sameSide = dir === car.driftSide;
    if (moving) {
      if (hand) rise = p.driftIn;
      else if (into > 0.3 && drive > 0.3 && Math.abs(beta) > (p.naturalSlip + 2) * DEG)
        rise = car.drift > 0.3 && sameSide ? p.driftIn : (sameSide || car.drift === 0) ? LIMIT_ENTRY * p.looseRear : 0;
    }
    if (rise > 0) car.drift = Math.min(1, car.drift + rise * dt);
    else car.drift = Math.max(0, car.drift - p.driftOut * (into < -0.3 || !sameSide ? 2 : 1) * (moving ? 1 : 3) * dt);
  }

  // 7. Yaw. Grip: steering asks for a turn rate. Drift: steering asks for an angle; the nose follows
  //    the path plus a correction toward that angle. Both: slip outside the allowed window is caught.
  const kin = Math.abs(vf) * Math.tan(p.lock * DEG) / WHEELBASE;
  const lim = G * p.turnG * gm / Math.max(Math.abs(vf), 1);
  const rateG = car.steer * Math.min(kin, lim) * (vf >= 0 ? 1 : -1);
  const d = car.drift;
  if (air) {
    car.yawRate *= Math.exp(-0.5 * dt);
  } else {
    let rT = rateG;
    if (vf > 2 && !car.reverse) {
      const c = d * dir * p.driftAngle * DEG * holdShare(p, into);          // angle the drift wants to hold
      const w = (1 - d) * p.naturalSlip * DEG * clamp(into, 0, 1); // free slip, only while steering into the turn
      const e = beta - clamp(beta, c - w, c + w);
      rT = (1 - d) * rateG + d * car.pathRate - p.slipCatch * e;
    }
    car.yawRate += (rT - car.yawRate) * (1 - Math.exp(-p.turnResp * surf * dt));
  }
  car.yaw = wrap(car.yaw + car.yawRate * dt);

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // 8. Outputs for the game.
  fx = Math.sin(car.yaw); fz = Math.cos(car.yaw); lx = fz; lz = -fx;
  car.vf = car.vx * fx + car.vz * fz;
  car.vl = car.vx * lx + car.vz * lz;
  car.speed = v1;
  car.slipAngle = v1 > 1 ? Math.atan2(-car.vl, Math.abs(car.vf)) : 0;
  car.drifting = d > 0.5;
  const lockEff = Math.atan(WHEELBASE * Math.min(kin, lim) / Math.max(Math.abs(vf), 0.5));
  const lockMax = p.lock * DEG;
  car.steerVis = (1 - d) * car.steer * lockEff + d * clamp(-car.slipAngle + 0.2 * car.steer * lockMax, -lockMax, lockMax);
  car.skid = air ? 0 : clamp(Math.max((Math.abs(car.slipAngle) / DEG - p.naturalSlip) / 12,
    hand && v1 > 2 ? 0.7 : 0, brk > 0.5 && !car.reverse && v1 > 3 ? 0.3 : 0), 0, 1);
  return car;
}
