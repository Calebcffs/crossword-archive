// Guided uploader for a new puzzle.
//
//   npm run add
//
// What it does, step by step:
//   1. Finds the newest .ipuz you exported from Ingrid (looks in ~/Documents,
//      ~/Downloads and ~/Desktop). You can also paste a different path.
//   2. Asks you for the puzzle's details in plain fields, with sensible
//      defaults you can accept by pressing Enter.
//   3. Creates src/puzzles/<slug>/ with an index.md (the metadata) and copies
//      the puzzle in as puzzle.ipuz.
//   4. Rebuilds the site so the puzzle shows up at the top of the archive.
//      (You never edit the index HTML by hand — Eleventy generates it from the
//      folders. Adding the folder IS how the index updates.)
//   5. Offers to commit and push to GitHub for you, explaining each git command.
//
// No extra libraries — this uses only what ships with Node.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PUZZLES_DIR = path.join(REPO_ROOT, "src", "puzzles");
// Where puzzle exports usually land. First match (newest file) wins.
const SEARCH_DIRS = ["Documents", "Downloads", "Desktop"].map((d) =>
  path.join(os.homedir(), d)
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// Pull answers from an async line iterator rather than rl.question(). This
// queues input correctly whether you type answers live or the lines arrive all
// at once (e.g. piped in), so no answer is ever dropped between prompts.
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? "" : value;
}

// A coloured tick / cross / arrow, kept ASCII-safe and simple.
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = (msg) => console.log(`  \x1b[36m›\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

function fail(msg) {
  console.error(`\n  \x1b[31m✗ ${msg}\x1b[0m\n`);
  rl.close();
  process.exit(1);
}

// Turn a title into the permanent URL slug (same rule as scripts/new-puzzle.js).
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Find the single newest .ipuz across the search directories.
function findNewestIpuz() {
  let newest = null;
  for (const dir of SEARCH_DIRS) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue; // directory doesn't exist — skip it
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

// A dropped/pasted path from a terminal often has surrounding quotes or a
// trailing space, and may start with ~ — normalise all of that.
function cleanPath(input) {
  let p = input.trim().replace(/^['"]|['"]$/g, "").trim();
  if (p.startsWith("~")) p = path.join(os.homedir(), p.slice(1));
  return p;
}

// Read an .ipuz file and return its parsed JSON, or null if it can't be parsed.
// Some tools wrap the JSON in an ipuz(...) callback — unwrap that first.
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

// Derive a friendly title from a filename like "20260701 SNACKY BUT THEMELESS".
function titleFromFilename(file) {
  let base = path.basename(file).replace(/\.ipuz$/i, "");
  base = base.replace(/^\d{6,8}[\s_-]*/, ""); // strip a leading date stamp
  base = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  // Title Case, but leave already-capitalised acronyms alone.
  return base.replace(/\b\w+/g, (w) =>
    w === w.toUpperCase() && w.length > 1 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()
  );
}

// Pull a YYYY-MM-DD date out of a filename stamp like "20260701", else today.
function dateFromFilename(file) {
  const m = path.basename(file).match(/(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo}-${d}`;
  }
  return new Date().toISOString().slice(0, 10);
}

// Escape a string so it's safe inside a double-quoted YAML value.
const yamlString = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Run a git command, returning stdout. Throws on failure.
function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

// ---------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n\x1b[1mAdd a puzzle to the archive\x1b[0m\n");

  // --- 1. Pick the puzzle file -------------------------------------------
  let ipuzPath = findNewestIpuz();
  if (ipuzPath) {
    info(`Newest puzzle found:  ${ipuzPath.replace(os.homedir(), "~")}`);
    const useIt = (await ask("  Use this file? [Y/n] ")).trim().toLowerCase();
    if (useIt === "n" || useIt === "no") ipuzPath = null;
  } else {
    warn("No .ipuz found in ~/Documents, ~/Downloads or ~/Desktop.");
  }

  if (!ipuzPath) {
    const typed = await ask("  Path to the .ipuz file (you can drag it into the terminal): ");
    ipuzPath = cleanPath(typed);
  }

  if (!ipuzPath || !fs.existsSync(ipuzPath)) fail(`File not found: ${ipuzPath}`);
  if (!ipuzPath.toLowerCase().endsWith(".ipuz")) fail("That isn't an .ipuz file.");

  // Validate it parses, so a broken export is caught before publishing.
  const ipuz = readIpuz(ipuzPath);
  if (!ipuz) {
    warn("This file doesn't parse as valid .ipuz JSON — it may be corrupt.");
    const cont = (await ask("  Add it anyway? [y/N] ")).trim().toLowerCase();
    if (cont !== "y" && cont !== "yes") fail("Stopped. Re-export the puzzle and try again.");
  } else {
    ok("Puzzle file looks valid.");
  }

  // --- 2. Collect the metadata -------------------------------------------
  console.log("\n  \x1b[1mDetails\x1b[0m  (press Enter to accept the [default])\n");

  const defaultTitle =
    (ipuz && typeof ipuz.title === "string" && ipuz.title.trim()) ||
    titleFromFilename(ipuzPath);
  let title = (await ask(`  Title [${defaultTitle}]: `)).trim() || defaultTitle;
  while (!title) title = (await ask("  Title (required): ")).trim();

  const defaultDate = dateFromFilename(ipuzPath);
  let date = (await ask(`  Date [${defaultDate}]: `)).trim() || defaultDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    warn(`"${date}" isn't YYYY-MM-DD — using ${defaultDate} instead.`);
    date = defaultDate;
  }

  const diffChoices = { 1: "Easy", 2: "Medium", 3: "Hard" };
  const diffRaw = (await ask("  Difficulty — [1] Easy  [2] Medium  [3] Hard  [2]: ")).trim();
  const difficulty = diffChoices[diffRaw] || "Medium";

  const tagsRaw = (await ask("  Tags (comma-separated, optional): ")).trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const teaser = (await ask("  Teaser — one line shown in the list (optional): ")).trim();
  const commentary = (await ask("  Commentary shown above the puzzle (optional): ")).trim();

  // --- 3. Work out the folder, guard against clashes ---------------------
  const slug = slugify(title);
  if (!slug) fail("That title has no usable letters or numbers for a URL.");
  const dir = path.join(PUZZLES_DIR, slug);
  if (fs.existsSync(dir)) {
    fail(`A puzzle folder already exists: src/puzzles/${slug}/\n` +
      "  Choose a different title, or delete that folder first.");
  }

  // Build the index.md front matter.
  let frontMatter = `---\ntitle: ${yamlString(title)}\ndate: ${date}\ndifficulty: ${difficulty}\n`;
  if (tags.length) {
    frontMatter += "tags:\n" + tags.map((t) => `  - ${t}`).join("\n") + "\n";
  } else {
    frontMatter += "tags: []\n";
  }
  if (teaser) frontMatter += `teaser: ${yamlString(teaser)}\n`;
  frontMatter += "---\n";
  const body = commentary ? `\n${commentary}\n` : "";

  // Show a summary and confirm before writing anything.
  console.log("\n  \x1b[1mReady to add:\x1b[0m");
  info(`Folder:     src/puzzles/${slug}/`);
  info(`Title:      ${title}`);
  info(`Date:       ${date}   Difficulty: ${difficulty}`);
  info(`Tags:       ${tags.length ? tags.join(", ") : "(none)"}`);
  info(`Teaser:     ${teaser || "(none)"}`);
  const go = (await ask("\n  Create it? [Y/n] ")).trim().toLowerCase();
  if (go === "n" || go === "no") fail("Cancelled — nothing was changed.");

  // --- 4. Write the files -------------------------------------------------
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), frontMatter + body);
  fs.copyFileSync(ipuzPath, path.join(dir, "puzzle.ipuz"));
  ok(`Created src/puzzles/${slug}/index.md`);
  ok("Copied the puzzle in as puzzle.ipuz");

  // --- 5. Rebuild so the archive picks it up -----------------------------
  info("Rebuilding the site…");
  try {
    execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "pipe" });
    ok("Built — the puzzle now appears at the top of the archive.");
    info(`Preview locally with:  npm run dev  →  http://localhost:8080/puzzles/${slug}/`);
  } catch (err) {
    warn("The build reported a problem:");
    console.log(String(err.stdout || err.message));
    warn("The files were created; fix the issue, then build again.");
  }

  // --- 6. Offer to publish to GitHub -------------------------------------
  console.log("");
  const publish = (await ask("  Push to GitHub now? [y/N] ")).trim().toLowerCase();
  if (publish !== "y" && publish !== "yes") {
    info("Left it local. When you're ready, run these yourself:");
    console.log(`      git add src/puzzles/${slug}`);
    console.log(`      git commit -m "Add puzzle: ${title}"`);
    console.log(`      git push`);
    rl.close();
    return;
  }

  try {
    // git add — stage the new folder so it's included in the commit.
    git(["add", path.join("src", "puzzles", slug)]);
    ok("Staged the new folder (git add).");

    // git commit — save a snapshot with a message.
    git(["commit", "-m", `Add puzzle: ${title}`]);
    ok("Saved a commit (git commit).");

    // git push — send it to GitHub. Set the upstream on the first push.
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    let hasUpstream = true;
    try {
      git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    } catch {
      hasUpstream = false;
    }
    info(`Pushing to GitHub (git push)…`);
    if (hasUpstream) {
      git(["push"]);
    } else {
      git(["push", "-u", "origin", branch]);
    }
    ok("Pushed to GitHub. GitHub Pages will rebuild and publish in a minute or two.");
  } catch (err) {
    warn("A git step failed:");
    console.log(String(err.stderr || err.stdout || err.message));
    warn("Your files are safe locally. You can finish by hand with git add / commit / push.");
  }

  rl.close();
}

main().catch((err) => fail(err.message));
