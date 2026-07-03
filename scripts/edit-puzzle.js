// Guided editor for an existing puzzle.
//
//   npm run edit
//
// The companion to `npm run add`. It:
//   1. Lists the puzzles you already have and lets you pick one.
//   2. Shows each field pre-filled with its current value — press Enter to keep
//      it, or type a new value to change it.
//   3. Optionally swaps in a new .ipuz file (e.g. a corrected grid).
//   4. Writes the updated index.md, rebuilds, and offers to commit + push.
//
// Important: this never renames the puzzle's folder. The folder name is the
// permanent public URL, so changing the title only changes the displayed
// title, not the link. (If you truly need a new URL, that's a manual job.)
//
// Uses gray-matter (already installed as part of Eleventy) to read/write the
// front matter safely, plus only built-in Node modules otherwise.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

let matter;
try {
  matter = (await import("gray-matter")).default;
} catch {
  console.error(
    "\n  Could not load the 'gray-matter' library.\n" +
      "  Run 'npm install' in this folder and try again.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers (kept in step with scripts/add-puzzle.js)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PUZZLES_DIR = path.join(REPO_ROOT, "src", "puzzles");
const SEARCH_DIRS = ["Documents", "Downloads", "Desktop"].map((d) =>
  path.join(os.homedir(), d)
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? "" : value;
}

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = (msg) => console.log(`  \x1b[36m›\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

function fail(msg) {
  console.error(`\n  \x1b[31m✗ ${msg}\x1b[0m\n`);
  rl.close();
  process.exit(1);
}

function cleanPath(input) {
  let p = input.trim().replace(/^['"]|['"]$/g, "").trim();
  if (p.startsWith("~")) p = path.join(os.homedir(), p.slice(1));
  return p;
}

function readIpuz(file) {
  try {
    let text = fs.readFileSync(file, "utf8").trim();
    if (text.startsWith("ipuz(")) {
      text = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findNewestIpuz() {
  let newest = null;
  for (const dir of SEARCH_DIRS) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".ipuz")) continue;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { path: full, mtimeMs: stat.mtimeMs };
      }
    }
  }
  return newest ? newest.path : null;
}

// Turn whatever the front matter stored for `date` into a plain YYYY-MM-DD
// string. gray-matter may hand it back as a Date object or a string.
function toDateString(value) {
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
}

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

// Find every puzzle folder (a src/puzzles/<slug>/ that contains index.md),
// read its front matter, and return them newest-first like the live site.
function listPuzzles() {
  let entries;
  try {
    entries = fs.readdirSync(PUZZLES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const puzzles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdPath = path.join(PUZZLES_DIR, entry.name, "index.md");
    if (!fs.existsSync(mdPath)) continue;
    let parsed;
    try {
      parsed = matter(fs.readFileSync(mdPath, "utf8"));
    } catch {
      parsed = { data: {}, content: "" };
    }
    puzzles.push({
      slug: entry.name,
      dir: path.join(PUZZLES_DIR, entry.name),
      mdPath,
      data: parsed.data || {},
      content: parsed.content || "",
    });
  }
  // Sort by date descending; undated puzzles fall to the end.
  puzzles.sort((a, b) => {
    const da = toDateString(a.data.date) || "";
    const db = toDateString(b.data.date) || "";
    return db.localeCompare(da);
  });
  return puzzles;
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n\x1b[1mEdit an existing puzzle\x1b[0m\n");

  // --- 1. Choose which puzzle --------------------------------------------
  const puzzles = listPuzzles();
  if (puzzles.length === 0) fail("No puzzles found in src/puzzles/. Add one with: npm run add");

  console.log("  Which puzzle?\n");
  puzzles.forEach((p, i) => {
    const date = toDateString(p.data.date) || "no date";
    const title = p.data.title || "(untitled)";
    console.log(`    \x1b[1m${String(i + 1).padStart(2)}\x1b[0m  ${title}  \x1b[2m— ${date} · ${p.slug}\x1b[0m`);
  });

  const pickRaw = (await ask("\n  Number: ")).trim();
  const pick = Number.parseInt(pickRaw, 10);
  if (!Number.isInteger(pick) || pick < 1 || pick > puzzles.length) {
    fail("That isn't one of the numbers listed.");
  }
  const puzzle = puzzles[pick - 1];
  info(`Editing: ${puzzle.data.title || puzzle.slug}  (URL stays /puzzles/${puzzle.slug}/)`);

  // --- 2. Edit each field (Enter keeps the current value) ----------------
  console.log("\n  \x1b[1mEdit fields\x1b[0m  (press Enter to keep the [current] value)\n");

  const curTitle = puzzle.data.title || "";
  let title = (await ask(`  Title [${curTitle}]: `)).trim() || curTitle;
  while (!title) title = (await ask("  Title (required): ")).trim();

  const curDate = toDateString(puzzle.data.date) || new Date().toISOString().slice(0, 10);
  let date = (await ask(`  Date [${curDate}]: `)).trim() || curDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    warn(`"${date}" isn't YYYY-MM-DD — keeping ${curDate}.`);
    date = curDate;
  }

  const curDiff = puzzle.data.difficulty || "Medium";
  const diffChoices = { 1: "Easy", 2: "Medium", 3: "Hard" };
  const diffRaw = (await ask(`  Difficulty — [1] Easy  [2] Medium  [3] Hard  [keep: ${curDiff}]: `)).trim();
  const difficulty = diffChoices[diffRaw] || curDiff;

  // The file's own tags never include the internal "puzzle" tag (that's added
  // globally in puzzles.11tydata.js), so we only touch the display tags here.
  const curTags = Array.isArray(puzzle.data.tags) ? puzzle.data.tags : [];
  const tagsPrompt = curTags.length ? curTags.join(", ") : "none";
  const tagsRaw = await ask(`  Tags (comma-separated) [${tagsPrompt}]: `);
  let tags;
  if (tagsRaw.trim() === "") {
    tags = curTags; // Enter keeps existing tags
  } else if (tagsRaw.trim().toLowerCase() === "none") {
    tags = []; // typing "none" clears them
  } else {
    tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const curTeaser = puzzle.data.teaser || "";
  const teaserRaw = await ask(`  Teaser [${curTeaser || "none"}]: `);
  let teaser;
  if (teaserRaw.trim() === "") teaser = curTeaser;
  else if (teaserRaw.trim().toLowerCase() === "none") teaser = "";
  else teaser = teaserRaw.trim();

  // Commentary is the Markdown body. Show it, offer to replace it with one line
  // (for longer multi-paragraph notes, editing the file directly is easier).
  const curBody = puzzle.content.trim();
  console.log(`\n  Current commentary: ${curBody ? `\x1b[2m${curBody.replace(/\n/g, " ")}\x1b[0m` : "(none)"}`);
  const bodyChoice = (await ask("  Replace commentary? [y/N] ")).trim().toLowerCase();
  let body = puzzle.content;
  if (bodyChoice === "y" || bodyChoice === "yes") {
    const newBody = (await ask("  New commentary (leave blank to remove it): ")).trim();
    body = newBody ? `\n${newBody}\n` : "\n";
  }

  // --- 3. Optionally replace the puzzle file -----------------------------
  const ipuzName = typeof puzzle.data.ipuzFile === "string" ? puzzle.data.ipuzFile : "puzzle.ipuz";
  const replace = (await ask(`\n  Replace the puzzle file (${ipuzName})? [y/N] `)).trim().toLowerCase();
  let newIpuzPath = null;
  if (replace === "y" || replace === "yes") {
    let candidate = findNewestIpuz();
    if (candidate) {
      info(`Newest .ipuz found: ${candidate.replace(os.homedir(), "~")}`);
      const useIt = (await ask("  Use this file? [Y/n] ")).trim().toLowerCase();
      if (useIt === "n" || useIt === "no") candidate = null;
    }
    if (!candidate) {
      candidate = cleanPath(await ask("  Path to the .ipuz file: "));
    }
    if (!candidate || !fs.existsSync(candidate)) fail(`File not found: ${candidate}`);
    if (!candidate.toLowerCase().endsWith(".ipuz")) fail("That isn't an .ipuz file.");
    if (!readIpuz(candidate)) {
      const cont = (await ask("  That file doesn't parse as valid .ipuz. Use it anyway? [y/N] ")).trim().toLowerCase();
      if (cont !== "y" && cont !== "yes") fail("Stopped — nothing was changed.");
    }
    newIpuzPath = candidate;
  }

  // --- 4. Confirm, then write --------------------------------------------
  console.log("\n  \x1b[1mReady to save:\x1b[0m");
  info(`Folder:     src/puzzles/${puzzle.slug}/   (URL unchanged)`);
  info(`Title:      ${title}`);
  info(`Date:       ${date}   Difficulty: ${difficulty}`);
  info(`Tags:       ${tags.length ? tags.join(", ") : "(none)"}`);
  info(`Teaser:     ${teaser || "(none)"}`);
  if (newIpuzPath) info(`Puzzle file: replace with ${path.basename(newIpuzPath)}`);
  const go = (await ask("\n  Save changes? [Y/n] ")).trim().toLowerCase();
  if (go === "n" || go === "no") fail("Cancelled — nothing was changed.");

  // Update the front matter object, preserving any keys we don't manage here
  // (e.g. thumbnail, ipuzFile). Keep date as a plain YYYY-MM-DD string.
  const data = { ...puzzle.data };
  data.title = title;
  data.date = date;
  data.difficulty = difficulty;
  data.tags = tags;
  if (teaser) data.teaser = teaser;
  else delete data.teaser;

  fs.writeFileSync(puzzle.mdPath, matter.stringify(body, data));
  ok(`Updated src/puzzles/${puzzle.slug}/index.md`);

  if (newIpuzPath) {
    fs.copyFileSync(newIpuzPath, path.join(puzzle.dir, ipuzName));
    ok(`Replaced ${ipuzName}`);
  }

  // --- 5. Rebuild ---------------------------------------------------------
  info("Rebuilding the site…");
  try {
    execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "pipe" });
    ok("Built successfully.");
    info(`Preview locally with:  npm run dev  →  http://localhost:8080/puzzles/${puzzle.slug}/`);
  } catch (err) {
    warn("The build reported a problem:");
    console.log(String(err.stdout || err.message));
    warn("Your changes were saved; fix the issue, then build again.");
  }

  // --- 6. Offer to publish -----------------------------------------------
  console.log("");
  const publish = (await ask("  Push changes to GitHub now? [y/N] ")).trim().toLowerCase();
  if (publish !== "y" && publish !== "yes") {
    info("Left it local. When you're ready, run these yourself:");
    console.log(`      git add src/puzzles/${puzzle.slug}`);
    console.log(`      git commit -m "Edit puzzle: ${title}"`);
    console.log(`      git push`);
    rl.close();
    return;
  }

  try {
    git(["add", path.join("src", "puzzles", puzzle.slug)]);
    ok("Staged the changes (git add).");
    git(["commit", "-m", `Edit puzzle: ${title}`]);
    ok("Saved a commit (git commit).");

    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    let hasUpstream = true;
    try {
      git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    } catch {
      hasUpstream = false;
    }
    info("Pushing to GitHub (git push)…");
    if (hasUpstream) git(["push"]);
    else git(["push", "-u", "origin", branch]);
    ok("Pushed. GitHub Pages will rebuild and publish in a minute or two.");
  } catch (err) {
    warn("A git step failed:");
    console.log(String(err.stderr || err.stdout || err.message));
    warn("Your files are safe locally. Finish by hand with git add / commit / push.");
  }

  rl.close();
}

main().catch((err) => fail(err.message));
