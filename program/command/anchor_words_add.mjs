import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildProgram } from "../program.mjs";

const args = process.argv.slice(2);

function readFlagValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1) return args[index + 1] ?? null;
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  return null;
}

function readFormValue(sentence) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string") return sentence.ob.name;
  return null;
}

function readAnchorName(sentence) {
  if (typeof sentence?.su?.name === "string") return sentence.su.name;
  return null;
}

function readAnchorRole(sentence) {
  return sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? null;
}

const anchor = readFlagValue("--anchor");
const form = readFlagValue("--form") ?? readFlagValue("--text");
const role = readFlagValue("--role");
const fileOverride = readFlagValue("--file");

if (!anchor || !form || !role) {
  console.error("Usage: node program/command/anchor_words_add.mjs --anchor <name> --form <text> --role <role> [--file <path>]");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const defaultPath = path.resolve(repoRoot, "program/verbs/exchange/translation/anchor_words.pya");
const anchorPath = fileOverride ? path.resolve(fileOverride) : defaultPath;

const text = await fs.readFile(anchorPath, "utf8");
const program = buildProgram(text);

const entries = [];
for (const sentence of program.sentences ?? []) {
  const entryAnchor = readAnchorName(sentence);
  const entryForm = readFormValue(sentence);
  if (!entryAnchor || !entryForm) continue;
  entries.push({
    anchor: entryAnchor,
    form: entryForm,
    role: readAnchorRole(sentence)
  });
}

const exists = entries.find((entry) => entry.anchor === anchor && entry.form === form && entry.role === role);
if (exists) {
  console.log(`# already present: ${anchor} -> ${form} (${role})`);
  process.exit(0);
}

const lines = text.split(/\r?\n/);
const prahIndex = [...lines].map((line, index) => [line, index]).reverse().find(([line]) => line.trim() === "prah")?.[1];
if (prahIndex == null) {
  console.error("anchor_words_add: could not find trailing 'prah' in anchor words file");
  process.exit(1);
}

const entryLine = `su name ${anchor} ob text ${JSON.stringify(String(form))} as wo ${role} ya`;
lines.splice(prahIndex, 0, entryLine);

await fs.writeFile(anchorPath, `${lines.join("\n")}\n`, "utf8");
console.log(entryLine);
