const fs = require("node:fs");
const path = require("node:path");

// Embeds the Copilot CLI adapter sources under .github/extensions/codetour/
// into a generated TypeScript module so `codetour --install copilot` can write
// them into the user's extension directory without any dependency on this
// Git repository (spec: agent-integrations-copilot-codex.md, Copilot CLI
// distribution). The strings travel with the compiled CLI bundle instead of
// relying on packaged resource files.
//
// The .mjs files are the readable source of truth. After editing them, run
// `node scripts/embed-copilot-extension.js` and commit both copies; the unit
// test agentIntegrations.test.ts fails when they diverge.

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, ".github", "extensions", "codetour");
const target = path.join(root, "src", "cli", "copilot-extension.generated.ts");

const files = fs
  .readdirSync(sourceDir)
  .filter(file => file.endsWith(".mjs"))
  .sort();

if (!files.length) throw new Error(`No Copilot extension files found in ${sourceDir}.`);

const banner = [
  "// GENERATED FILE - do not edit by hand.",
  "// Regenerate with `node scripts/embed-copilot-extension.js` after editing the",
  "// adapter sources in .github/extensions/codetour/. The unit test",
  "// agentIntegrations.test.ts fails when this module diverges from them.",
  "",
].join("\n");

const entries = files.map(file => {
  const content = fs.readFileSync(path.join(sourceDir, file), "utf8");
  return `  ${JSON.stringify(file)}: ${JSON.stringify(content)}`;
});

fs.writeFileSync(
  target,
  `${banner}export const COPILOT_EXTENSION_FILES: Readonly<Record<string, string>> = {\n${entries.join(",\n")}\n};\n`
);
console.log(`Embedded ${files.length} Copilot extension files into ${path.relative(root, target)}`);
