import fs from "node:fs";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { setEntryModuleDir } from "../bridge/modules.mjs";
import { setExchangeRunRoot } from "../bridge/exchange.mjs";

function resolveTargetDir(sentence, { rememberFn } = {}) {
  const to = sentence?.to ?? {};
  if (typeof to.filename === "string") return to.filename;
  if (typeof to.text === "string") return to.text;
  if (to.name && rememberFn) {
    const fact = rememberFn(to.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  const fallback = renderSayValue(to, { rememberFn });
  return fallback !== undefined ? String(fallback) : "";
}

export async function go(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveTargetDir(sentence, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "go target missing",
      message: "go target missing",
      from: { name: "go" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "go target missing",
      message: `go target missing: ${resolved}`,
      from: { name: "go" },
      raw: { error: err?.message }
    });
  }
  if (!stats?.isDirectory?.()) {
    throwErrorSentence({
      name: "go target defective",
      message: `go target defective: ${resolved}`,
      from: { name: "go" },
      raw: { resolved }
    });
  }
  process.chdir(resolved);
  setEntryModuleDir(resolved);
  setExchangeRunRoot(resolved);
  return { ob: { filename: resolved }, be: "go" };
}

export default go;

export const signatures = [
  { signatureWords: ["be", "go", "to", "filename"], handler: go },
  { signatureWords: ["be", "go", "to", "name", "filename"], handler: go },
  { signatureWords: ["be", "go", "to", "name", "text"], handler: go },
  { signatureWords: ["be", "go", "to", "text"], handler: go }
];
