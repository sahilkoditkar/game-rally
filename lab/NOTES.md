# Clean-room arcade rally handling — design notes

Everything here was designed from the brief only. No existing game code, notes or harnesses were read.
Files: `handling.js` (the model), `track.js` (lab course), `lab.html` + `lab.js` (drive it), `bots.js` +
`measure.mjs` (numeric proxies, output in `results.md`), `labtest.cjs` (Playwright checks, screenshots in `shots/`).

## What good arcade handling has to get right (the design brief I set myself)

1. **Digital input is the norm.** A key is either full lock or nothing, so the model must turn a held key into
   a sensible line at every speed, and a short tap into a small, proportionate correction.
2. **The relationship between where the nose points and where the car goes is most of the feel.** If velocity
   snaps to the heading the car is on rails and cannot drift. If velocity lags too much the car "skids
   sideways and doesn't turn". So this relationship needs its own explicit, tunable parameters.
3. **A drift must turn the path, not just the nose.** In a drift the player's input has to keep controlling the
   line, and it has to be obvious how to get out.
4. **No hidden modes the player has to discover.** Behaviour should change continuously with inputs.
5. **Nothing should be able to spin the car.** Casual players should never have to catch a car that is rotating
   away from them.

## The model in plain words

Each 1/120 s step does this:

1. **Steering shaping.** The steer value moves toward the key at `steerSpeed` (full lock per second) and returns
   to centre twice as fast. So a 0.1 s tap gives about half lock, and letting go is crisp.
2. **Tyres pull the velocity toward the nose.** Sideways velocity (relative to the car) dies away with a time
   constant `tyreLag`, but the tyres can never push harder than `grip` (in g). Nose rotation the tyres cannot
   follow becomes slip angle. This is the single relationship the feel hangs on.
3. **Drive and brakes act along the nose.** Acceleration is `accel × (1 − (v/top)²)`, which gives exact top
   speed and a natural taper. The driven wheels can use 75% of tyre grip for drive, less whatever cornering is
   using (a friction circle), but never less than half of that. So you can always power out of a slide, and
   snow accelerates more slowly. Braking is `brakeDecel`, capped by grip.
4. **Steering asks for a turn rate.** At low speed the rate is limited by the steering lock (`lock`, a kinematic
   bicycle with the 2.5 m wheelbase). At speed it is limited by a lateral-acceleration budget (`turnG`). A held
   key therefore gives a radius that grows smoothly with speed, and never an impossible demand. The nose
   follows that request with a first-order response `turnResp`. When `turnG` exceeds `grip`, the car asks for
   more than the tyres give and slides a little at the limit. That ratio is the "looseness" of the chassis.
5. **Slip is always steered back.** Any slip angle outside an allowed window is converted into a yaw-rate
   correction of `slipCatch` per second. While you steer into a turn, the window is ±`naturalSlip` (a little
   free tail-out). When you release the key the window closes, so the car tidies itself up. This term is why
   the car cannot spin under any input, and why releasing a key reliably straightens it.
6. **One continuous drift level (0..1)**, which is the only state beyond motion and gear. It blends what
   steering means:
   - at 0, steering means "turn this fast" (point 4);
   - at 1, steering means "hold this angle and pull this hard". Steering into the slide holds `driftAngle` and
     lets the tyres pull with `driftGrip × grip`. A released key keeps the `neutralHold` share of both angle and
     pull. A countersteer keeps none, so the car lines up with its current path and runs straight on. The nose
     follows the path's rotation plus a correction toward the wanted angle, so the drift angle is held while the
     velocity is pulled around the corner.

   The drift level rises with the **handbrake** (`driftIn` per second). It is sustained by steering into the
   slide with throttle on. If `looseRear` > 0, it can also start by itself when you are on the throttle, steering
   into a slide that has gone beyond the free slip window (rate `looseRear × 2.5/s`, deliberately gradual). It
   fades at `driftOut` per second when you release the steer or lift off, twice as fast when you countersteer. It
   belongs to one side, so a countersteer straightens the car and never swings it into an opposite drift
   ("pendulum") unless the player starts a new one.
7. **Slide scrub.** A sliding tyre's force partly points backwards along the travel direction and costs speed.
   `slideScrub` is the share of that loss that is kept, so it tunes "drifting is slow" against "drifting carries
   speed".
8. **Reverse** engages after the brake is held for 0.25 s at a standstill with no throttle. Throttle switches back
   to forward. **Airborne**: no tyre or drive forces, yaw rate decays slowly, nothing else changes. **Off-road**:
   up to 30% less grip and up to 4 m/s² of extra drag (constants; the game punishes off-road elsewhere).
   **Slope**: `−g × slope` along the heading.

Everything is either an exact exponential or a clamped impulse, so it is stable at dt = 1/60 and needs no
sub-stepping. There is no randomness. Input is read once per call, so feeding the same input for every sub-step
of a frame gives bit-identical results at 10 fps and 60 fps when the input timeline is the same.

## Parameters (one slider each)

| key | slider label | what it does | if you raise it |
|---|---|---|---|
| topSpeed | Top speed | Exact top speed on the flat. | Faster straights. |
| accel | Launch acceleration | Acceleration from rest (9.3 gives 0–100 in 3.5 s). | Punchier; still capped by traction. |
| brakeDecel | Brake strength | Deceleration on the brake, capped by grip. | Shorter stops. |
| steerSpeed | Steer key speed | How fast a key reaches full lock (returns twice as fast). | Quicker, twitchier turn-in; taps do more. |
| lock | Steering lock | Slow-speed tightness (hairpins, U-turns). | Tighter at low speed only. |
| turnG | Turn rate at speed | Cornering the steering ASKS for at speed. | Turns harder at speed. Above `grip`, the tail slides at the limit. |
| turnResp | Turn-in response | How fast the nose reaches the asked-for rate. | Sharper and more immediate. Lower feels heavier. |
| grip | Tyre grip | Cornering the tyres DELIVER (g). | Higher corner speeds, fewer slides. |
| tyreLag | Path lag | How long the travel direction takes to follow the nose. | Floatier and slidier, harder to place. |
| naturalSlip | Free slip angle | Tail-out allowed while steering into a turn. | More visible slip, looser look. |
| slipCatch | Slide catch | How hard extra slip is pulled back. | Safer and stiffer. Lower is more lively. |
| driftAngle | Drift angle | Angle a drift holds while you steer into it. | Bigger, showier drifts that turn tighter. |
| neutralHold | Drift kept when released | Share of drift angle and pull kept with steer released. | Drifts linger more on a released key. |
| driftGrip | Drift pull | Grip while drifting, × tyre grip. | Drifts pull the car around harder. |
| slideScrub | Speed a slide costs | Share of the sliding-tyre speed loss that is kept. | Drifting is slower. |
| driftIn | Drift build-up | How fast the handbrake (and sustaining) builds the drift. | Snappier handbrake entries. |
| driftOut | Drift fade | How fast a drift fades when you let go. | Quicker exits. |
| looseRear | Loose rear | Throttle at the limit starts a drift without the handbrake. | More spontaneous drifts. |

Constants (not sliders, documented in the file): wheelbase 2.5 m, reverse top speed 29 km/h, handbrake drag
3.5 m/s², coast drag, minimum drift speed 6 m/s, off-road grip loss and drag, 75% drive traction, 50% drive
while sliding, 0.25 s brake-hold before reverse, limit-slide entry rate 2.5/s.

## The three presets

- **grip**: planted and precise. The car goes where the nose points and only slides when you pull the handbrake
  (24° drifts that fade quickly). Highest `grip` relative to `turnG`, short `tyreLag`, strong `slipCatch`,
  `looseRear` 0.
- **flow** (recommended default): sharp turn-in, small natural slides at the limit (`turnG` > `grip` by about
  7%, 3.5° free slip). A handbrake tap gives a 32° drift with 10% extra pull that holds its line while you steer
  into it and tidies itself up within about 0.6 s when you let go. Almost never drifts by itself
  (`looseRear` 0.15).
- **slide**: loose and lively. 4.5° of visible tail-out in every corner, 40° drifts with 15% extra pull that keep
  60% of their angle on a released key, and a gradual throttle-at-the-limit drift entry (`looseRear` 0.3). Still
  pulled back by `slipCatch` 7.

Same `topSpeed`/`accel` for all three, so the choice is purely about handling.

## What I tried and rejected (and why)

- **Drift pull fixed at the grip limit regardless of steering.** In the first version a drift always pulled
  with the same force, so the player's input changed the angle but not the line. That is the "skids sideways
  and doesn't turn" trap. Now steering into / releasing / countersteering also sets how hard the drift pulls.
- **Brake-and-turn as a drift trigger (trail-brake entry).** The first bot traces showed a digital player braking
  for a corner while holding the key on a 140 km/h sweeper snapping into a 20° drift. Casual players brake with
  the key held all the time. Removed: the handbrake is the drift button.
- **A free-slip window that stays open when the key is released.** It made the car keep turning after the key
  came up (delayed, overshooting response) and roughly tripled the delayed-digital bot's road exits. Now the
  window only exists while steering into the turn.
- **Drift level shared between sides.** It allowed countersteer to swing a left drift straight into a full right
  drift. Now a drift belongs to one side.
- **Instant drift from a limit slide** (full `driftIn` rate). It snapped a 7° slide into a 40° drift in 0.15 s.
  Now limit entry is gradual (`looseRear × 2.5/s`).
- **Long path lag (0.06–0.09 s) for the looser presets.** It made them wobbly on straights for the delayed
  digital bot rather than drifty in corners. Looseness now comes from the slip window, catch strength and the
  drift settings, not from a lazy front end.
- **Unlimited drive in a drift.** Drifts gained speed under full throttle, especially on snow. Fixed with the
  traction circle (with a 50% floor so you can always power out) plus per-preset `slideScrub`.

## Mapping upgrades onto the parameters later

| upgrade | scale these | notes |
|---|---|---|
| Engine | `accel` (punch), `topSpeed` | Traction still caps `accel` on loose surfaces, so engine upgrades matter less on snow. That is realistic and keeps snow friendly. |
| Tyres | `grip` (main), `driftGrip` slightly, `tyreLag` down slightly | Raising `grip` alone also reduces natural slides, because `turnG / grip` drops. Raise `turnG` by the same factor to keep the character and only add speed. |
| Brakes | `brakeDecel` | Capped by `grip`, so good brakes need tyres to match. |
| Suspension / handling | `turnResp` up, `slipCatch` up, `tyreLag` down | Sharper and more stable without changing top cornering speed. |
| Steering rack (if wanted) | `lock` | Hairpins only. |
| "Rally setup" / drift kit (cosmetic choice) | `driftAngle`, `neutralHold`, `looseRear`, `slideScrub` | Purely character, no pace change. |

Rule of thumb for upgrades: scale `grip` and `turnG` together (pace), and leave `slipCatch`, `naturalSlip` and the
drift parameters to the preset (character).

## Honest limits of the measurements

- The bots are proxies. The "human" bot is a delayed digital controller with motion extrapolation. It does not
  learn, does not drift on purpose, and steers with grip-driving logic even during a drift. It is a good detector
  of a car that weaves or punishes key taps, and a poor judge of how fun or learnable a drift is.
- The steer-only bot never brakes, so it cannot make the 12 m hairpins from straight-line speed on any preset.
  That reflects the brief's phone mode (auto-accelerate plus brake and handbrake buttons), not something the
  chassis should fix. If phone players are expected to only steer, auto-accelerate itself should ease off
  (that belongs in the input layer).
- Closed-loop bots at 10 fps do worse than at 60 fps because the bot makes decisions 6× less often. The model
  itself is bit-identical for the same input timeline.
- Nothing here measures feel. Turn-in sharpness, how readable the drift angle is from the chase camera, and
  whether `neutralHold` makes key-tapping through a drift intuitive can only be judged by someone driving it.
