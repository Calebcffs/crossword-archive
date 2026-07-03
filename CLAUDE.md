# Crossword Archive

Static crossword archive site. Eleventy 3 (ESM, Nunjucks) + vendored Exolve
player for `.ipuz` puzzles. Deployed to GitHub Pages via Actions.

- Owner is a beginner web developer: prefer simple, well-commented solutions
  over clever ones; explain Git commands when using them.
- `npm run dev` = local preview, `npm run build` = build to `_site/`.
- `npm run add` = guided uploader (scripts/add-puzzle.js): finds the newest
  .ipuz in ~/Documents/~/Downloads/~/Desktop, asks for metadata, writes the
  puzzle folder, rebuilds, and optionally commits + pushes. This is the normal
  way to publish a puzzle. `npm run new -- "Title"` still scaffolds an empty
  puzzle folder by hand if ever needed.
- One puzzle = one folder: `src/puzzles/<slug>/{index.md, puzzle.ipuz}`.
  The slug is the permanent URL — never rename published puzzle folders.
- `src/assets/vendor/exolve/` is third-party code — update by re-downloading
  (see README), never hand-edit.
- Internal links in templates must use the `| url` filter (GitHub Pages
  serves the site under a path prefix set by the deploy workflow).
- Site-wide settings (title, author, promo links) live in `src/_data/site.js`.
- Backend is intentionally absent. If ratings/play counts are ever added,
  use Firebase as a small progressive enhancement on puzzle pages only.
