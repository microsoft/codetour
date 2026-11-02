const fs = require("node:fs");
const path = require("node:path");

// Embeds the Markdown skill sources under packages/mcp-server/review-skill/
// into a generated TypeScript module so the critical review skill pack is
// guaranteed present offline in every distribution (npm package, VSIX,
// standalone bundle): the strings travel with the compiled server instead
// of relying on packaged resource files.
//
// The Markdown files are the readable source of truth. After editing them,
// run `node scripts/embed-review-skill.js` and commit both copies; the unit
// test review-skill.test.ts fails when they diverge.

const packageRoot = path.resolve(__dirname, "..", "packages", "mcp-server");
const sourceRoot = path.join(packageRoot, "review-skill");
const target = path.join(packageRoot, "src", "review-skill.generated.ts");

const sources = [
  ["UPSTREAM_CODE_REVIEW_SKILL", "upstream-code-review.md"],
  ["UPSTREAM_CODE_REVIEW_LICENSE", "upstream-LICENSE.txt"],
  ["CODETOUR_CRITICAL_REVIEW_ADAPTATION", "codetour-adaptation.md"],
];

const banner = [
  "// GENERATED FILE - do not edit by hand.",
  "// Regenerate with `node scripts/embed-review-skill.js` after editing the",
  "// Markdown sources in packages/mcp-server/review-skill/. The unit test",
  "// review-skill.test.ts fails when this module diverges from them.",
  "",
].join("\n");

const generatedExports = sources.map(([constant, file]) => {
  const content = fs.readFileSync(path.join(sourceRoot, file), "utf8");
  return `export const ${constant}: string = ${JSON.stringify(content)};`;
});

fs.writeFileSync(target, `${banner}${generatedExports.join("\n\n")}\n`);
console.log(`Embedded ${sources.length} skill sources into ${path.relative(packageRoot, target)}`);
