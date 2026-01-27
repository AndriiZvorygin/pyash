import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const query = process.argv[2];
if (!query) {
  console.error("usage: node program/command/ryan.mjs <prefix>");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const lyacDir = resolve(repoRoot, "caterer/pyac/lyac");
const output = execFileSync(
  "node",
  ["ryan.js", query],
  { cwd: lyacDir, encoding: "utf8" }
);

process.stdout.write(output);
