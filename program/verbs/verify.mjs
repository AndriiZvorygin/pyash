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
  if (mode === "word count") return "word count";
  throwVerifyError(`verify defective: unsupported mode ${mode}`, { sentence });
}

async function resolveSourceTextFromFilename(rawFilename, { rememberFn = remember } = {}) {
  const { resolved, outside } = resolveAgentPath(rawFilename, { rememberFn });
  const filePath = outside ? path.resolve(String(rawFilename)) : resolved;
  const text = await fs.readFile(filePath, "utf8");
  return { text, source: filePath };
}

async function resolvePyashSourceText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.ob?.text === "string") {
    return { text: sentence.ob.text, source: "" };
  }
  if (typeof sentence?.ob?.name === "string") {
    const fact = rememberFn(sentence.ob.name);
    const text = fact?.ob?.text;
    if (typeof text === "string") return { text, source: sentence.ob.name };
  }
  if (typeof sentence?.from?.filename === "string" && sentence.from.filename.trim()) {
    return resolveSourceTextFromFilename(sentence.from.filename, { rememberFn });
  }
  throwVerifyError("verify defective: expected from filename or ob text", { sentence });
}

function resolveWordCountBounds(sentence) {
  const atleastRaw = sentence?.atleast?.num;
  const atmostRaw = sentence?.atmost?.num;
  const atleast = Number.isFinite(atleastRaw) ? Number(atleastRaw) : null;
  const atmost = Number.isFinite(atmostRaw) ? Number(atmostRaw) : null;
  if (atleast === null && atmost === null) {
    throwVerifyError("verify defective: expected atleast num or atmost num", { sentence });
  }
  if (atleast !== null && atmost !== null && atleast > atmost) {
    throwVerifyError("verify defective: atleast cannot exceed atmost", { sentence });
  }
  return { atleast, atmost };
}

function countWords(text) {
  const matches = String(text ?? "").trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

async function resolveWordCountSourceText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.ob?.text === "string") {
    return { text: sentence.ob.text, source: "ob text" };
  }
  if (typeof sentence?.from?.filename === "string" && sentence.from.filename.trim()) {
    return resolveSourceTextFromFilename(sentence.from.filename, { rememberFn });
  }
  if (typeof sentence?.from?.name === "string" && sentence.from.name.trim()) {
    const fact = rememberFn(sentence.from.name);
    const fromText = fact?.ob?.text;
    if (typeof fromText === "string") {
      return { text: fromText, source: sentence.from.name };
    }
    const fromFilename = fact?.ob?.filename;
    if (typeof fromFilename === "string" && fromFilename.trim()) {
      return resolveSourceTextFromFilename(fromFilename, { rememberFn });
    }
  }
  throwVerifyError("verify defective: expected from filename or from name or ob text", { sentence });
}

async function verifyWordCount(sentence, { rememberFn = remember } = {}) {
  const { text, source } = await resolveWordCountSourceText(sentence, { rememberFn });
  const { atleast, atmost } = resolveWordCountBounds(sentence);
  const words = countWords(text);
  const pass =
    (atleast === null || words >= atleast)
    && (atmost === null || words <= atmost);
  return {
    ob: {
      map: {
        pass,
        words,
        atleast,
        atmost,
        source
      }
    },
    be: "map"
  };
}

export async function verify(sentence, { remember: rememberFn = remember } = {}) {
  const mode = resolveVerifyMode(sentence);
  if (mode === "word count") {
    return verifyWordCount(sentence, { rememberFn });
  }
  const { text, source } = await resolvePyashSourceText(sentence, { rememberFn });
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
  { signatureWords: ["be", "verify", "as", "wo", "pyash", "ob", "text", "to", "name", "series", "do"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "filename"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "num"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "filename"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "ob", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "filename", "to", "name", "num"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "filename", "to", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "filename", "to", "name", "map"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "num", "to", "name", "num"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "num", "to", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "num", "to", "name", "map"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "text", "to", "name", "num"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "text", "to", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "text", "to", "name", "map"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "filename", "to", "name", "num"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "filename", "to", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "from", "name", "filename", "to", "name", "map"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "ob", "text", "to", "name", "num"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "ob", "text", "to", "name", "text"], handler: verify },
  { signatureWords: ["be", "verify", "as", "wo", "word count", "atleast", "num", "atmost", "num", "ob", "text", "to", "name", "map"], handler: verify }
];

export default verify;
