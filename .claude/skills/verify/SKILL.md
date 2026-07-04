---
name: verify
description: How to build, serve, and drive this site in a headless browser to verify changes end-to-end.
---

# Verifying changes to the crossword archive

The site is fully static, so verification = build it, serve `_site/`,
and drive pages in headless Chrome.

## Build and serve

```bash
npm run build                                  # writes _site/
python3 -m http.server 8123 -d _site &         # simple static server
```

(Don't use `file://` — puzzle pages fetch their .ipuz with fetch(), and
localStorage behaves differently.)

## Drive it

System Chrome lives at `/usr/bin/google-chrome`. Install `puppeteer-core`
in the session scratchpad (NOT in this repo — keep package.json clean):

```bash
cd <scratchpad> && npm init -y && npm install puppeteer-core
```

```js
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
```

Collect `page.on('console')` errors and `page.on('pageerror')` on every run.

## Flows worth driving

- Home `/`, listing `/puzzles/`, and a puzzle page
  (e.g. `/puzzles/20260701-snacky-but-themeless/`). On the puzzle page,
  wait for the Exolve grid: `document.querySelector('.xlv-grid, svg')`.
- **Music** (`src/assets/js/music.js`): the engine keeps its AudioContext
  private. To observe it, instrument before page load with
  `page.evaluateOnNewDocument`: wrap `window.AudioContext` to capture the
  instance and wrap `OscillatorNode.prototype.start` to count scheduled
  notes. Toggle is `#music-toggle`; preference is localStorage key
  `study-music`. Simulate puzzle completion by dispatching
  `new CustomEvent('exolve', { bubbles: true, detail: { knownIncorrect: false } })`
  on `document` — that's the event real Exolve fires.

## Gotchas

- Internal URLs must respect the path prefix; locally PATH_PREFIX is
  unset so everything is under `/`.
- Headless audio is muted; "AudioContext state === 'running'" plus a
  growing oscillator-start count is the playback evidence.
