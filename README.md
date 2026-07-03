# Crossword Archive

My personal crossword archive: a static website where visitors can browse,
read about, and play my puzzles directly in the browser.

- **Generator:** [Eleventy](https://www.11ty.dev/) — turns the files in `src/` into plain HTML
- **Player:** [Exolve](https://github.com/viresh-ratnakar/exolve) — renders `.ipuz` files as interactive crosswords
- **Hosting:** GitHub Pages — free, rebuilt automatically on every push

## Everyday commands

Run these from this folder in a terminal:

| Command | What it does |
|---|---|
| `npm run dev` | Preview the site at <http://localhost:8080> (auto-reloads as you edit) |
| `npm run new -- "Puzzle Title"` | Scaffold a new puzzle folder |
| `npm run build` | Build the site into `_site/` (only needed for checking; deploys build themselves) |
| `npm run art` | Regenerate the pixel art in `src/assets/img/` (only needed after editing `scripts/make-art.js`) |

## How to add a puzzle

1. Run `npm run new -- "My Puzzle Title"`. This creates
   `src/puzzles/my-puzzle-title/index.md` with metadata ready to fill in.
2. In Ingrid, export the puzzle as **ipuz** and save it as
   `src/puzzles/my-puzzle-title/puzzle.ipuz`.
3. Edit `index.md`: set the difficulty, tags, teaser line, and write any
   commentary below the `---` block (Markdown works).
4. Optional: drop a `thumbnail.png` into the folder and add
   `thumbnail: thumbnail.png` to the front matter to show a grid preview
   in the archive list.
5. Preview with `npm run dev`, then commit and push (see below).

The puzzle's web address comes from the folder name:
`src/puzzles/my-puzzle-title/` → `/puzzles/my-puzzle-title/`.
Don't rename a folder after publishing, or its link breaks for anyone who
bookmarked it.

## Publishing changes (the Git workflow)

```bash
git status                        # see what changed
git add .                         # stage all changes for the next snapshot
git commit -m "Add puzzle: ..."   # record the snapshot with a message
git push                          # upload to GitHub → site redeploys itself
```

The site rebuilds automatically 1–2 minutes after each push (watch the
**Actions** tab on GitHub if you're curious).

## Where things live

```
src/
├── _data/site.js        ← site title, your name, portfolio/blog/CV links
├── _includes/layouts/   ← page templates (base, page, puzzle)
├── assets/
│   ├── css/style.css    ← all styling (colours defined at the top)
│   ├── img/             ← pixel art (generated — edit scripts/make-art.js, then `npm run art`)
│   └── vendor/exolve/   ← the crossword player (third-party, don't edit)
├── puzzles/
│   └── <one-folder-per-puzzle>/
│       ├── index.md     ← metadata + commentary
│       └── puzzle.ipuz  ← the puzzle itself, exported from Ingrid
├── index.njk            ← homepage
├── puzzles.njk          ← archive page
├── about.md             ← about page
└── contact.md           ← contact page
```

Everything in `src/` becomes the website. `_site/` (the built output) and
`node_modules/` (installed packages) are disposable and not committed.

## Updating the puzzle player

Exolve is vendored (copied into the repo) so the site never breaks because
of an upstream change. To update it, re-download these three files into
`src/assets/vendor/exolve/`:

```bash
for f in exolve-m.js exolve-m.css exolve-from-ipuz.js; do
  curl -sL "https://raw.githubusercontent.com/viresh-ratnakar/exolve/master/$f" \
    -o "src/assets/vendor/exolve/$f"
done
```

## Roadmap / ideas

- [ ] Replace placeholder links in `src/_data/site.js` and the About page text
- [ ] Tag pages (all puzzles with a given tag)
- [ ] RSS/Atom feed so people can subscribe to new puzzles
- [ ] Firebase (later, only if wanted): play counts, ratings, favourites —
      added as a small script on puzzle pages; no site restructuring needed
