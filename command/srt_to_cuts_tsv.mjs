import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  return "Usage: node command/srt_to_cuts_tsv.mjs <input.srt> <output.tsv>";
}

function parseSrt(text) {
  const blocks = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const rows = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const idx = Number(lines[0]);
    if (!Number.isFinite(idx)) continue;
    const timing = lines[1];
    const match = timing.match(/^(.+?)\s+-->\s+(.+)$/);
    if (!match) continue;
    const start = match[1].trim();
    const end = match[2].trim();
    const textLine = lines.slice(2).join(" ").replace(/\s+/g, " ").trim();
    if (!textLine) continue;
    rows.push([String(idx), start, end, textLine]);
  }
  return rows;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error(usage());
    process.exit(1);
  }

  const inputText = await fs.readFile(inputPath, "utf8");
  const rows = parseSrt(inputText);
  const tsv = rows.map((row) => row.join("\t")).join("\n") + (rows.length ? "\n" : "");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, tsv, "utf8");
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
