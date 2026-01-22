import { throwErrorSentence } from "../error.mjs";

function boolFromResult(result) {
  if (typeof result === "boolean") return result;
  if (typeof result === "string") {
    const norm = result.trim().toLowerCase();
    if (norm.includes("truth")) return true;
    if (norm.includes("lie")) return false;
  }
  const candidate = result?.ob ?? result?.value ?? result;
  if (candidate?.boolean !== undefined) return Boolean(candidate.boolean);
  if (candidate?.bool !== undefined) return Boolean(candidate.bool);
  if (candidate?.num !== undefined) return Boolean(candidate.num);
  if (candidate?.text !== undefined) {
    const norm = String(candidate.text).trim().toLowerCase();
    if (norm === "truth" || norm === "true" || norm === "1") return true;
    if (norm === "lie" || norm === "false" || norm === "0") return false;
  }
  return null;
}

async function evaluateClause(clause) {
  if (!clause) return null;
  const { interpret } = await import("../bridge/index.mjs");
  const res = await interpret(clause);
  return boolFromResult(res);
}

export async function notVerb(sentence) {
  const clause = sentence?.ob?.la;
  const value = await evaluateClause(clause);
  if (value === null) {
    throwErrorSentence({
      name: "not defective",
      message: "not defective",
      from: { name: "not" },
      raw: { sentence }
    });
  }
  return { ob: { boolean: !value }, be: "not" };
}

export default notVerb;

export const signatures = [
  { signatureWords: ["be", "not", "ob", "la"], handler: notVerb }
];
