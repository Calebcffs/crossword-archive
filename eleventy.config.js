export default function (eleventyConfig) {
  // Copy static assets straight to the output, unchanged.
  eleventyConfig.addPassthroughCopy("src/assets");
  // Copy puzzle files (and any images/PDFs) that sit alongside each puzzle page.
  eleventyConfig.addPassthroughCopy("src/puzzles/**/*.{ipuz,png,jpg,jpeg,webp,gif,pdf}");

  // All puzzles, newest first. A puzzle = any src/puzzles/<folder>/index.md file.
  eleventyConfig.addCollection("puzzles", (api) =>
    api.getFilteredByGlob("src/puzzles/*/index.md").sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addFilter("readableDate", (date) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(date)
  );

  // Tags used for display (drops the internal "puzzle" collection tag).
  eleventyConfig.addFilter("topicTags", (tags) =>
    (tags || []).filter((t) => t !== "puzzle")
  );

  eleventyConfig.addFilter("limit", (array, n) => array.slice(0, n));

  eleventyConfig.addShortcode("year", () => String(new Date().getFullYear()));

  // A number that changes on every build. Appended to the stylesheet URL
  // (style.css?v=...) so browsers never keep using an old cached copy
  // after the site is redeployed.
  eleventyConfig.addGlobalData("buildId", () => String(Date.now()));

  return {
    dir: {
      input: "src",
      output: "_site",
    },
    // On GitHub Pages the site lives under /<repo-name>/. The deploy workflow
    // sets PATH_PREFIX; locally it stays "/" so previews just work.
    pathPrefix: process.env.PATH_PREFIX || "/",
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
