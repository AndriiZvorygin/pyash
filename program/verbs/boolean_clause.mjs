export function boolFromResult(result) {
  if (typeof result === "boolean") return result;
  if (typeof result === "string") {
    const norm = result.trim().toLowerCase();
    if (norm.includes("truth")) return true;
    if (norm.includes("lie")) return false;
  }
  const candidate = result?.ob ?? result?.value ?? result;
  if (typeof candidate === "boolean") return candidate;
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

export async function evaluateBooleanClause(clause, { remember } = {}) {
  if (!clause) return null;
  if (clause.mood === "ya" && typeof clause.ob?.boolean === "boolean") {
    return clause.ob.boolean;
  }

  let normalized = clause;
  if (
    ["equally", "tiny", "giant"].includes(clause.be)
    && clause.ob !== undefined
    && clause.su === undefined
  ) {
    let subject = clause.ob;
    if (subject?.name && typeof remember === "function") {
      subject = remember(subject.name)?.ob ?? subject;
    }
    const { ob: _ob, ...rest } = clause;
    normalized = { ...rest, su: subject };
  }

  const { interpret } = await import("../bridge/index.mjs");
  return boolFromResult(await interpret(normalized));
}
