import fs from "node:fs/promises";
import path from "node:path";
import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveAgentPath } from "../library/agent_cwd.mjs";
import { verifyPyashText, buildVerifyOutcomeSeries } from "../library/pyash_verify.mjs";

function throwVerifyError(message, raw = {}) {
  throwErrorSentence({
    name: "verify defective",
    message,
    from: { name: "verify" },
    raw
  });
}

function resolveVerifyMode(sentence) {
  const mode = String(sentence?.as?.wo ?? sentence?.as?.text ?? sentence?.as?.name ?? "pyash").trim().toLowerCase();
  if (!mode || mode === "pyash") return "pyash";
  throwVerifyError(`verify defective: unsupported mode ${mode}`, { sentence });
}

async function resolveSourceText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.ob?.text === "string") {
    return { text: sentence.ob.text, source: "" };
  }
  if (typeof sentence?.ob?.name === "string") {
    const fact = rememberFn(sentence.ob.name);
    const text = fact?.ob?.text;
    if (typeof text === "string") return { text, source: sentence.ob.name };
  }
  if (typeof sentence?.from?.filename === "string" && sentence.from.filename.trim()) {
    const rawFilename = sentence.from.filename;
    const { resolved, outside } = resolveAgentPath(rawFilename, { rememberFn });
    const filePath = outside ? path.resolve(String(rawFilename)) : resolved;
    const text = await fs.readFile(filePath, "utf8");
    return { text, source: filePath };
  }
  throwVerifyError("verify defective: expected from filename or ob text", { sentence });
}

export async function verify(sentence, { remember: rememberFn = remember } = {}) {
  resolveVerifyMode(sentence);
  const { text, source } = await resolveSourceText(sentence, { rememberFn });
  const report = verifyPyashText(text, { source });
  return buildVerifyOutcomeSeries(report);
}

export const signatures = [
  { signatureWords: ["be", "verify", "from", "filename", "as", "wo", "pyash"], handler: verify },
  { signatureWords: ["be", "verify", "from", "filename", "as", "wo", "pyash", "do"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "from", "filename"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "from", "filename", "do"], handler: verify },
  { signatureWords: ["be", "verify", "ob", "text", "as", "wo", "pyash"], handler: verify },
  { signatureWords: ["be", "verify", "ob", "text", "as", "wo", "pyash", "do"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "text", "do"], handler: verify },
  { signatureWords: ["be", "verify", "ob", "name", "text", "as", "wo", "pyash"], handler: verify },
  { signatureWords: ["be", "verify", "ob", "name", "text", "as", "wo", "pyash", "do"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "name", "text", "do"], handler: verify },
  { signatureWords: ["be", "verify", "from", "filename", "as", "wo", "pyash", "to", "name", "series"], handler: verify },
  { signatureWords: ["be", "verify", "from", "filename", "as", "wo", "pyash", "to", "name", "series", "do"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "from", "filename", "to", "name", "series"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "from", "filename", "to", "name", "series", "do"], handler: verify },
  { signatureWords: ["be", "verify", "ob", "text", "as", "wo", "pyash", "to", "name", "series"], handler: verify },
  { signatureWords: ["be", "verify", "ob", "text", "as", "wo", "pyash", "to", "name", "series", "do"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "text", "to", "name", "series"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "text", "to", "name", "series", "do"], handler: verify }
];

export default verify;
