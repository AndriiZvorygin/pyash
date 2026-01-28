import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const ryanPath = resolve(repoRoot, "caterer/pyac/lyac/program/ryan.mjs");
const { queryRyan } = await import(ryanPath);

export async function queryRyanLines(prefix) {
  return queryRyan(prefix);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const query = process.argv[2];
  if (!query) {
    console.error("usage: node program/command/ryan.mjs <prefix>");
    process.exit(1);
  }
  const lines = await queryRyanLines(query);
  process.stdout.write(lines.join("\n"));
}
