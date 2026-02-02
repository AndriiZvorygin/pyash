import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { recordArtifact, recordExchange } from "../bridge/exchange.mjs";
import { resolveAgentPath } from "../library/agent_cwd.mjs";

function resolveFilename(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

export async function touch(sentence, { remember: rememberFn = remember } = {}) {
  const target = resolveFilename(sentence?.ob, { rememberFn });
  if (!target) {
    throwErrorSentence({
      name: "touch target missing",
      message: "touch target missing",
      from: { name: "touch" },
      raw: { sentence }
    });
  }
  const { resolved, outside, agentCwd } = resolveAgentPath(String(target), { rememberFn });
  if (outside) {
    throwErrorSentence({
      name: "touch defective",
      message: `touch defective: outside agent cwd (${agentCwd})`,
      from: { name: "touch" },
      raw: { target }
    });
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  let handle;
  try {
    handle = await fs.open(resolved, "a");
    await handle.close();
  } catch (err) {
    throwErrorSentence({
      name: "touch defective",
      message: `touch defective: ${resolved}`,
      from: { name: "touch" },
      raw: { error: err?.message }
    });
  }
  const now = new Date();
  try {
    await fs.utimes(resolved, now, now);
  } catch {}
  try {
    const bytes = await fs.readFile(resolved);
    const artifact = recordArtifact({ locator: resolved, producer: "exchange", bytes });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "write", producer: "exchange" });
    }
  } catch {}
  return { ob: { filename: resolved }, be: "touch" };
}

export default touch;

export const signatures = [
  { signatureWords: ["be", "touch", "ob", "filename"], handler: touch },
  { signatureWords: ["be", "touch", "ob", "name", "filename"], handler: touch },
  { signatureWords: ["be", "touch", "ob", "text"], handler: touch },
  { signatureWords: ["be", "touch", "ob", "name", "text"], handler: touch }
];
