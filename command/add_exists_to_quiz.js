// Add "exists" to the first declarative for each subject name in quiz files.
import fs from "node:fs";
import path from "node:path";
import { parse } from "../program/understand/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const quizDir = path.join(root, "quiz");

const files = fs.readdirSync(quizDir).filter(f => f.endsWith(".mjs"));

for (const file of files) {
  const full = path.join(quizDir, file);
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split("\n");
  const declared = new Set();
  let changed = false;

  const newLines = lines.map(line => {
    const matches = [...line.matchAll(/`([^`]+)`/g)];
    if (matches.length === 0) return line;

    let newLine = line;
    for (const m of matches) {
      const snippet = m[1];
      const parsed = parse(snippet);
      if (!parsed || parsed.mood !== "ya" || !parsed.subj?.name) continue;
      if (declared.has(parsed.subj.name)) continue;

      parsed.exists = true;
      declared.add(parsed.subj.name);
      const rendered = sentenceToPyash(parsed);
      if (rendered && rendered !== snippet) {
        newLine = newLine.replace(snippet, rendered);
        changed = true;
      }
    }

    return newLine;
  });

  if (changed) {
    fs.writeFileSync(full, newLines.join("\n"), "utf8");
    console.log("updated", file);
  }
}
