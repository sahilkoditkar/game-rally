# Dustline

A pocket rally: a low-poly, flat-shaded time-trial game that runs in the browser.
Twelve stages in four regions (forest, desert, snow, coast), some of them at night or in
the rain, plus a new Daily Stage generated from the date. One car, one clock. Beat your best time and split times on each stage; records are kept in
your browser's local storage.

Built with plain ES modules and three.js (vendored in `vendor/`). There is no build step and
nothing is loaded from the network.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Gas / brake (reverse) | `↑` `↓` or `W` `S` | RT / LT | GAS / BRAKE |
| Steer | `←` `→` or `A` `D` | left stick | ◀ ▶ |
| Handbrake | `Space` | A | HAND |
| Reset onto road | `R` | Y | RESET |
| Camera (chase / far chase / low action) | `C` | | |
| Pause | `Esc` | Start | ‖ button |
| Sound / ghost on or off | `M` / `G` | | Settings |
| Settings (sound, ghost, controls) | `Esc` in Play | Y in the menu | gear button |
| Menu: choose an entry / start it | `↑` `↓` / `Enter` | d-pad ▲ ▼ / A | tap, tap again |
| Menu: previous / next tab (region or Daily) | `←` `→` or `Q` `E` | d-pad ◀ ▶, LB / RB | tabs |
| Menu: Play / Garage | `V` | Select | tabs |
| Menu: Solo / Duel | `1` / `2` | | SOLO / DUEL pill |
| Results: retry / continue, next stage, menu | `Enter`, `N`, `Esc` | A, X, B | buttons |

The full list (keyboard, gamepad and touch) is in **Settings › Controls**, opened from the gear in the
menu, `Esc` on the Play view, gamepad Y, or **Settings** in the pause panel. On every result panel `Enter`
(or A) presses the highlighted button (Retry, Rematch, Continue, Rally again) and `Esc` (or B) goes to the
menu; presses in the first 400 ms after a panel appears are ignored, so a held handbrake can't skip it.

### Rules

Stages are lined with **gates**: pairs of flagged poles across the road. Drive between every pair; a
floating marker shows your next gate (each player sees only their own in Duel). Penalties are added
to your stage time, so they count everywhere: splits, finish, best times, medals, ghosts, rally totals
and duel results. The numbers live in `src/rules.js`:

| Penalty | Time |
| --- | --- |
| Missed gate (passing outside the flags, or skipping it) | +5.0 s |
| Reset (`R`, or an automatic reset when you're off course or in the sea) | +2.0 s |

Resets in the first 3 s after GO are free, and one incident never charges two resets within 1.5 s.
A run with no penalties earns a **CLEAN RUN** badge and +40 CR. Deep rough slows you down, shakes the
camera and throws dark clods, and an OFF ROAD sign shows under the progress bar.

### Pace notes

Like a co-driver, the HUD calls each corner before you reach it: a curved arrow bent to match the corner,
its grade in the rally convention (**1** = tightest and slowest … **6** = fast kink), the direction (L / R)
and small tags: **long**, **tightens**, **opens**, and **→ into** when the next corner follows straight
after. Hairpins, crests (where a fast car goes light) and jumps get their own icons. A call appears about
3 s ahead at your current speed (never less than 45 m), a thin bar drains as you approach, and it slides
away once you're past the apex; the call after it shows smaller beside it. Colour follows the grade: red
for 1–2, mustard for 3–4, cream for 5–6. Notes are worked out from the road itself (`src/notes.js`), so every
stage, daily stage and future region has them. Turn them off in **Settings › Pace notes**.

### Medals

Every stage has a par time (the reference autopilot's time). Beat **par × 1.35** for bronze,
**par × 1.15** for silver, **par × 1.03** for gold and **par × 0.95** for the teal star-in-ring **Ace**. A stage's medal always comes from your best
time on it. Bronze, silver, gold and ace are worth 1, 2, 3 and 4 medal points (maximum 48). The Daily Stage shows a medal but does not count towards points. The menu shows
your points and each region's medals; the selected stage shows its four target times; during a run
the HUD shows the best medal still in reach.

### Rallies

Each region is also a rally: its three stages back to back on one cumulative clock. It is the fourth
entry in each region's list (**RALLY**, one `↓` below the stages): select it and press **START RALLY**.
Between stages a panel shows the stage time and medal and your total against par; `Enter` continues. Retries are off during a rally (`R` still puts the car
back on the road), and pausing offers Resume / Abandon rally. Stage times set in a rally count
towards stage bests and medals. The final results award a rally trophy (same factors applied to the
summed par) and keep your best total per region. Rallies also work in Duel, where the winner is
decided on total time and no records are kept.

### Garage: build your Rook

There is one car, the Rook R7, and you make it your own with credits. Every finished solo stage
pays out. The numbers live in one table (`EARN` in `src/economy.js`):

| Earned for | Credits |
| --- | --- |
| Finishing a stage | 100 + 12 per km |
| Medal of the run | bronze 35 / silver 65 / gold 120 / ace 200 |
| Each medal tier reached on a stage for the first time | 60 |
| Beating your personal best | 50 |
| First finish of today's Daily Stage | 120 |
| Completing a rally (+200 for a gold or ace trophy) | 250 |
| A clean run (no penalties) | 40 |

Duel and abandoned runs earn nothing. The finish panel itemises every payout.

Open the **Garage** (the GARAGE tab, or `V`) to spend them. Your credits sit in the menu's top bar:

- **Tune** has four upgrade lines (Engine, Tyres, Brakes, Suspension), each with three levels at 400 / 900 / 1,600 CR.
  Higher levels also need 8 and 18 medal points. The stat bars preview what the highlighted upgrade adds.
- **Style** covers paint, accent colour, livery, wheels, wing, roof, lamps, front, arches, mud flaps and number.
  Hovering or focusing an item shows it on the car; leaving reverts. Owned items fit instantly.
  Locked items say why ("needs 12 medal points", "needs Tyres: Rally compound", "120 CR short").

Purchases of 900 CR and up need a second press to confirm. In the Garage, `↑` `↓` choose a row,
`←` `→` choose an option, `Space` buys or fits it, `Q` / `E` switch Tune and Style and `Esc` goes back to Play.
`Enter` still starts the race. The Garage tab shows a dot when something is affordable. In Duel both cars
use your build (same performance and parts); Player 2 picks their own paint and accent from the colours
you own in **Garage › Style**, whose first row (`CAR  P1 | P2`) switches the car being edited and shown.

### Ghost

In solo, every run is recorded. When a run sets a new best on a stage, it is saved as that stage's ghost:
a translucent car that replays your best run on the next attempt (rallies included), with a live
**GHOST ±s** delta under the timer comparing you at the same point on the road. Toggle it in
**Settings** or with `G`; `?ghost=0` disables it. There are no ghosts in Duel. Ghosts take about 5 KB
per minute of driving; ghosts of past daily stages are pruned automatically.

### Duel (2 players, split screen)

Pick **Duel** with the SOLO / DUEL pill in the menu (or `2`). Both cars start side by side on the same stage. Each player has
their own timer, splits and camera. When both have finished, the results show the winner,
the gap and a split-by-split comparison. Duel times are not saved as solo records.

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Drive | `W` `A` `S` `D` | `↑` `←` `↓` `→` |
| Handbrake | `Left Shift` (or `Space`) | `Right Shift` or `Enter` |
| Reset onto road | `R` | `/` (or `Backspace`) |
| Camera | `C` | `.` |
| Gamepad | first pad | second pad |

Duel needs a keyboard or two gamepads, so the SOLO / DUEL pill is hidden on touch-only devices.

## Audio

Everything you hear is generated in the browser with WebAudio: no samples, no audio files.

- **Effects**: the engine, gravel, tyre scrub, impacts and beeps (one panned set per car in Duel).
- **Music**: a small procedural sequencer (`music` in `src/audio.js`). The menu has a slow, warm pad with a sparse
  plucked arpeggio. Stages get a steady driving pulse (soft kick and bass, arpeggio, pad) whose key, timbre and tempo
  follow the region: forest is warm and woody, desert brighter with a twang, snow glassy and sparse, coast a breezy
  major. Night is darker and a little slower and rain is mellower. Each stage seeds its own pair of chord
  progressions, and the arrangement changes every 8 bars. The music opens up a little with speed and drops by about
  10 dB while paused. On the results screen a short chord rings out, then the music drifts back into the menu bed.
- **Settings › Sound** switches all audio on or off (`M`). The **Music** and **Effects** sliders (0–100) are
  below it: drag them, or focus the row and use `←` `→` (d-pad on a gamepad). They are saved in your browser
  (`dustline.vol`).

Nothing is created or played until your first click, tap or key press.

## Run locally

ES modules need to be served over HTTP (opening `index.html` from disk won't work). Any
static server will do, from the repository root:

```sh
npx http-server -p 8080 -c-1     # or: python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

Handy URL parameters: `?stage=mesa` preselects a stage (an id, `daily`, or a 0-based index into
the stage list), `?mode=duel` preselects split-screen duel, `?rally=forest` preselects a region's rally (with `&start=1` it jumps straight in), `?build=max|stock|<json>` and `?credits=N` try builds without touching your saved profile, `?start=1` skips the menu, and `?auto=1` lets
the autopilot drive the race (both cars in a duel). `?cond=night,rain` forces conditions on any
stage, for testing.

## Code map

`src/main.js` runs the game: renderer, stage loading, game states, the loop and rendering.
The other modules each handle one part:

| Module | Contents |
| --- | --- |
| `track.js` | stage definitions, regions, the daily stage and terrain/road/scenery generation |
| `car.js` | car model, physics and autopilot |
| `audio.js` | procedural engine, gravel and beep sounds, the procedural music, effects / music volume buses |
| `catalog.js` | menu order, region and daily lookups, stage lengths and conditions (falls back to defaults if track.js lacks them) |
| `fx.js` | dust and spray puffs, rain streaks, night headlights |
| `player.js` | one racer: car, chase/orbit camera, viewport and timing |
| `hud.js` | per-player HUD panes (fixed slots: timer + penalty chip, two sub-chips, rally and gate pills by the progress bar, OFF ROAD) and the result panels |
| `menu.js` | main menu: top bar, Play / Garage tabs, region and Daily tabs (the tab is the selection), stage / rally / daily entries, the START label |
| `settings.js` | the Settings overlay: sound, music / effects volume, ghost and the controls reference (keyboard / gamepad / touch) |
| `nav.js` | roving keyboard / gamepad focus on the pause and result panels |
| `carapi.js` | the Rook's build API (upgrades, parts, paints) from car.js, with fallbacks |
| `economy.js` | credits, the earn table, the saved profile and purchases |
| `garage.js` | the Garage view: Tune and Style, previews, buying |
| `notes.js` | pace notes: corners (graded 1–6, hairpins, long / tightens / opens / into), crests and jumps from the road geometry, and their HUD cards |
| `rules.js` | gates, missed-gate and reset penalties, the next-gate marker |
| `ghost.js` | ghost recording, compact storage codec, replay and the ghost-delta lookup |
| `progress.js` | medals and medal points (derived from best times), rally pars, trophies and rally bests |
| `input.js` | keyboard, gamepad and touch input |
| `storage.js` | localStorage wrapper and best-time records |
| `util.js` | formatting and small maths helpers |

## Publish on GitHub Pages

All paths are relative, so the game works from a project sub-path.

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick your branch and the
   **/ (root)** folder, and save.
4. After a minute the game is live at `https://<user>.github.io/<repo>/`.

The empty `.nojekyll` file tells Pages to serve the files as they are.
