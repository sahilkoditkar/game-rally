# Dustline

A pocket rally: a low-poly, flat-shaded time-trial game that runs in the browser.
Three handmade-by-algorithm stages (autumn forest, high desert, alpine snow), one car,
one clock. Beat your best time and split times on each stage; records are kept in
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
| Camera (chase / high / top) | `C` | | |
| Mute | `M` | | |
| Pause | `Esc` | Start | ‖ button |
| Menu: choose stage / start | `←` `→` / `Enter` | d-pad / A | tap |

## Run locally

ES modules need to be served over HTTP (opening `index.html` from disk won't work). Any
static server will do, from the repository root:

```sh
npx http-server -p 8080 -c-1     # or: python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

Handy URL parameters: `?stage=1` preselects a stage (0-based index, or an id such as
`?stage=mesa`), `?start=1` skips the menu, `?auto=1` lets the autopilot drive the race.

## Publish on GitHub Pages

All paths are relative, so the game works from a project sub-path.

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick your branch and the
   **/ (root)** folder, and save.
4. After a minute the game is live at `https://<user>.github.io/<repo>/`.

The empty `.nojekyll` file tells Pages to serve the files as they are.
