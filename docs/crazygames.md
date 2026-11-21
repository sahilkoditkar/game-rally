# Dustline on CrazyGames

> The CrazyGames docs site (docs.crazygames.com) could not be opened from the environment this was written in,
> so everything below comes from search excerpts of those pages. Before you submit, check the numbers marked
> **verify** against the live docs and the submission form.

## How the platform layer works

The game only imports `src/platform/index.js`. That module picks an adapter when the game starts and loads
only that adapter:

1. `window.DUSTLINE_PLATFORM`, which a portal build sets in its `index.html`
2. otherwise the `?platform=` URL parameter (for testing)
3. otherwise `web`

| File | Role |
| --- | --- |
| `src/platform/index.js` | The interface: `init`, `loadingStart/Stop`, `gameplayStart/Stop` (repeated calls are ignored), `happytime`, `commercialBreak`, `rewardedBreak`, `hasRewarded`, `onAudioMute`, and `storage` (works like localStorage). Every break calls `onDone` exactly once, with time limits. |
| `src/platform/web.js` | GitHub Pages. Every call does nothing and saves go to localStorage. |
| `src/platform/crazygames.js` | HTML5 SDK v3: `init`, the game events, `requestAd` for midgame and rewarded ads, `settings.muteAudio`, and saves through the Data module. |
| `src/platform/policy.js` | Every pacing number and timeout. |
| `src/adbreak.js` | What the game does around an ad: when one may run, freezing the game, muting, the "Back in a moment…" veil and blocking input. |
| `src/platform/embed.js` | Applies only inside an iframe. It focuses the game at boot and stops PageUp, PageDown, Home and End from scrolling the portal page. |
| `src/boot.js` | The entry point. It waits for `platform.init()` (at most about 16 s), then loads `main.js`. |

On CrazyGames, saves go to the SDK Data module, using the same `dustline.*` keys as before. The first time a
player runs the game there, any `dustline.*` values already in localStorage are copied into the Data module
once. Each write also goes to localStorage, so a later session with the SDK blocked still has recent saves.
Progress made in such a session is not copied back into the Data module later.

If the SDK script is blocked or fails to load, or `init()` fails or takes too long, or the environment is
`disabled` (any domain that is not CrazyGames, localhost or `?useLocalSdk=true`), the adapter does nothing,
saves to localStorage, and logs one console warning. The game still starts.

### When the game calls the SDK

| Moment | Call |
| --- | --- |
| Boot, after `init` | `loadingStart` |
| First stage built, menu up | `loadingStop` |
| Countdown reaches GO, or resume from pause during a race | `gameplayStart` |
| Pause, all racers finished, quit to menu | `gameplayStop` (not when the tab is hidden: the docs say CrazyGames handles focus loss) |
| A stage medal better than before, or a rally trophy better than before | `happytime` |
| Retry or Next from a result panel, Continue from a rally interstitial, Rally again | `requestAd('midgame')`, if the policy allows one |

Ad policy (`src/platform/policy.js`):

- At most one ad attempt every 3 minutes. This matches the requirements page: "max 1 every 3 minutes",
  enforced by the SDK.
- No ad after the session's first run.
- If `adStarted` has not arrived after 10 s, the game gives up on the ad and carries on.
- If an ad has started but not finished after 90 s, the game carries on.

No ad plays while the player is driving. Rewarded ads work in the platform layer, but the game has no button
for them yet. See the TODO in `src/adbreak.js`.

## Build the zip

```sh
node scripts/build.mjs crazygames   # -> dist/dustline-crazygames.zip
node scripts/build.mjs web          # -> dist/dustline-web.zip (a plain copy of the game)
```

The build needs Node 18 or newer and no npm packages. The zip has `index.html` at its root, plus `style.css`,
`src/**` and `vendor/**`. The build adds these two tags to that `index.html` only:

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
<script>window.DUSTLINE_PLATFORM = "crazygames";</script>
```

To add another portal, add one entry to `TARGETS` in `scripts/build.mjs` and one adapter in `src/platform/`.

## Test locally

- **Headless tests** (need Playwright and `npx http-server`):
  - `node tests/web.test.mjs` checks the web build.
  - For the CrazyGames build, unzip it first, then run `node tests/crazygames.test.mjs <unzipped dir>`. This
    uses the mock SDK in `tests/cg-sdk-mock.js` and also tests a blocked SDK, a failed init and a `disabled`
    environment.
  - `node tests/iframe.test.mjs` checks iframe focus, keys not scrolling the parent page, and resizing.
- **Real SDK on localhost:** serve the unzipped build and open `http://localhost:<port>/`. On `localhost` and
  `127.0.0.1` the SDK runs in `local` mode, where ads are not available. On any other host, add
  `?useLocalSdk=true`.
- **QA tool:** this is the real check. In the developer portal, upload the zip and open it in the QA tool
  (preview). The tool runs the game as it would run on CrazyGames, tests the SDK features you implemented
  (ads, events, data) and reports problems against the requirements.

## Submitting

1. Sign in to the CrazyGames developer portal and create a new game. Choose the HTML5 type and upload
   `dist/dustline-crazygames.zip`.
2. Check the build in the QA tool: the loading and gameplay events, a midgame ad after a few runs (with the
   game muted while it plays), saves kept after a reload, and the desktop and mobile embed sizes.
3. Fill in the details page and upload the covers and videos (checklist below), then submit for review.
4. **Basic Launch:** the game goes live without any CrazyGames customisation. The SDK is optional, there is no
   monetisation, and ads stay disabled even if they are integrated. If the SDK is integrated, the
   gameplay-start event must still fire. The game is measured on its play metrics. Basic Launch ends after at
   least 7 days live and 500 plays, or after 21 days at the latest.
5. **Full Launch:** this happens only if CrazyGames selects the game. It then has to meet every integration
   requirement, including the SDK (full implementation: game events, ads at natural breaks, honouring
   `muteAudio`). This build already meets them. Payments, if you ever add any, must use Xsolla.

## Metadata checklist (owner)

- [ ] **Title:** Dustline
- [ ] **Short description** and a **longer description:** a low-poly rally time trial with 12 stages in 4
  regions, a Daily Stage, rallies, medals, a garage and ghosts.
- [ ] **Controls text:**
  - Arrows or WASD to drive
  - Space for the handbrake
  - R to reset the car onto the road
  - C to change the camera
  - Esc to pause
  - Duel: WASD against the arrows on one keyboard
  - Touch controls on mobile
- [ ] **Category / tags:** Driving, Racing (rally, time trial, low poly, 2 player).
- [ ] **Covers**, three images. **Verify** the sizes on the upload form; these come from secondary sources:
  - landscape 1920×1080
  - portrait 800×1200
  - square 800×800
  - No other portal's branding.
- [ ] **Preview videos**, landscape and portrait: 15–20 s of gameplay, at most 50 MB each, starting on the
  static cover.
  - Landscape is 1920×1080.
  - **Verify** the portrait size: sources disagree between 1080×1620 and 1080×1920.
- [ ] **Devices:** desktop and mobile. Solo plays on touch. Duel is hidden on touch-only devices because it
  needs a keyboard or two gamepads.
- [ ] **Age rating / content:** the game has no violence, chat, user-generated content or purchases. The site
  is aimed at players aged 13 and up.
