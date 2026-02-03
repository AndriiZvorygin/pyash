import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

function usage() {
  console.error("Usage: node command/compile_pya_to_js.mjs <path/to/file.pya>");
  process.exit(1);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) usage();

  const resolved = path.resolve(filePath);
  const text = await fs.readFile(resolved, "utf8");

  const sentences = splitSentences(text)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parse);

  const moduleSource = buildModuleSource({ sentences, sourcePath: resolved });
  process.stdout.write(moduleSource);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

function buildModuleSource({ sentences, sourcePath }) {
  const sentencesJson = JSON.stringify(sentences, null, 2);
  const banner = `// Generated from ${sourcePath}\n`;

  return [
    banner,
    "// Exports sentences as parsed Pyash objects and a run() helper that expects interpret/remember handlers.",
    "export const sentences = " + sentencesJson + ";\n",
    "export async function run({ interpret, remember, forget, allRemember } = {}) {",
    "  if (!interpret) throw new Error('interpret is required');",
    "  if (typeof forget === 'function') await forget();",
    "  const outputs = [];",
    "  for (const sentence of sentences) {",
    "    const res = await interpret(sentence);",
    "    if (sentence.mood === 'que') outputs.push(res);",
    "  }",
    "  const result = typeof remember === 'function' ? remember('result') : undefined;",
    "  const memory = typeof allRemember === 'function' ? allRemember() : undefined;",
    "  return { outputs, result, memory };",
    "}\n",
    "export default run;\n",
  ].join("\n");
}
