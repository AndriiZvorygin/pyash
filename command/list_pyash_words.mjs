import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const wordsPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "library", "pyashWords.json");
  const raw = await fs.readFile(wordsPath, "utf8");
  const entries = JSON.parse(raw);
  const english = entries.map(entry => entry.en).filter(Boolean);
  console.log(english.join(","));
}

main().catch(err => {
  console.error("Failed to list Pyash words:", err.message);
  process.exit(1);
});
