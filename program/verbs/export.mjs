import { state } from "../bridge/state.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveExportName(sentence) {
  if (typeof sentence?.su?.name === "string" && sentence.su.name.trim()) {
    return sentence.su.name.trim();
  }
  if (typeof sentence?.ob?.name === "string" && sentence.ob.name.trim()) {
    return sentence.ob.name.trim();
  }
  return null;
}

export async function exportFact(sentence) {
  const frame = state.refineryScopeStack[state.refineryScopeStack.length - 1] ?? null;
  if (!frame) {
    throwErrorSentence({
      name: "refinery produce defective",
      message: "export requires active refinery platform scope",
      from: { name: "export" },
      raw: sentence
    });
  }
  const name = resolveExportName(sentence);
  if (!name) {
    throwErrorSentence({
      name: "refinery produce defective",
      message: "export requires su name or ob name",
      from: { name: "export" },
      raw: sentence
    });
  }
  frame.exports.add(name);
  return { be: "bool", ob: { boolean: true } };
}

export default exportFact;

export const signatures = [
  { signatureWords: ["be", "export"], handler: exportFact },
  { signatureWords: ["be", "export", "ob", "name", "num"], handler: exportFact },
  { signatureWords: ["be", "export", "ob", "name", "text"], handler: exportFact },
  { signatureWords: ["be", "export", "ob", "name", "bool"], handler: exportFact },
  { signatureWords: ["be", "export", "ob", "name", "filename"], handler: exportFact },
  { signatureWords: ["be", "export", "ob", "name", "series"], handler: exportFact },
  { signatureWords: ["be", "export", "ob", "name", "map"], handler: exportFact }
];
