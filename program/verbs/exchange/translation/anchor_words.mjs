import fs from "node:fs/promises";
import { buildProgram } from "../../../program.mjs";

let cachedAnchorForms = null;
let cachedAnchorError = null;

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

function buildAnchorFormsFromProgram(program) {
  const formsToAnchor = new Map();
  const formsByAnchor = new Map();
  for (const sentence of program.sentences ?? []) {
    const anchor = readAnchorName(sentence);
    const form = readFormValue(sentence);
    if (!anchor || !form) continue;
    const role = readAnchorRole(sentence);
    formsToAnchor.set(form, anchor);
    if (!formsByAnchor.has(anchor)) {
      formsByAnchor.set(anchor, new Map());
    }
    if (role) {
      formsByAnchor.get(anchor).set(role, form);
    }
  }
  return { formsToAnchor, formsByAnchor };
}

export async function loadAnchorWordForms() {
  if (cachedAnchorForms) return cachedAnchorForms;
  if (cachedAnchorError) throw cachedAnchorError;
  try {
    const fileUrl = new URL("./anchor_words.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    const program = buildProgram(text);
    cachedAnchorForms = buildAnchorFormsFromProgram(program);
    return cachedAnchorForms;
  } catch (err) {
    cachedAnchorError = err;
    throw err;
  }
}
