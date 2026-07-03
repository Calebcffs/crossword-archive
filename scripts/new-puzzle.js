// Creates the folder and metadata file for a new puzzle.
// Usage: npm run new -- "My Puzzle Title"
import fs from "node:fs";
import path from "node:path";

const title = process.argv.slice(2).join(" ").trim();
if (!title) {
  console.error('Usage: npm run new -- "My Puzzle Title"');
  process.exit(1);
}

const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const dir = path.join("src", "puzzles", slug);
if (fs.existsSync(dir)) {
  console.error(`Error: ${dir} already exists.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "index.md"),
  `---
title: "${title.replace(/"/g, '\\"')}"
date: ${today}
difficulty: Medium
tags: []
teaser: One-line description shown in the archive list.
---

Anything you write here appears above the puzzle as commentary — how the
puzzle came about, hints, notes. Markdown works. Delete this text if you
don't want commentary.
`
);

console.log(`Created ${dir}/index.md`);
console.log("Next steps:");
console.log(`  1. Export the puzzle from Ingrid as ipuz and save it as ${dir}/puzzle.ipuz`);
console.log(`  2. Edit ${dir}/index.md (date, difficulty, tags, teaser, commentary)`);
console.log(`  3. Preview with: npm run dev  →  http://localhost:8080/puzzles/${slug}/`);
