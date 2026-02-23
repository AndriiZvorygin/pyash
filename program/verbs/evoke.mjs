import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getRefinery } from "../bridge/refinery.mjs";
import { state } from "../bridge/state.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function deepClone(value) {
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function resolveRefineryName(targetName) {
  const fact = remember(targetName);
  if (fact?.as?.name) return fact.as.name;
  if (fact?.from?.name) return fact.from.name;
  return targetName;
}

function resolveClauseSource(sentence) {
  if (sentence?.ob?.la && typeof sentence.ob.la === "object") return sentence.ob.la;
  const evoker = state.currentEvokeRef || state.currentEvoke;
  if (evoker?.from?.la && typeof evoker.from.la === "object") return evoker.from.la;
  return null;
}

function outputFactForResult({ outputTo, clauseTo }) {
  const outputName = typeof outputTo?.name === "string"
    ? outputTo.name
    : (typeof clauseTo?.name === "string" ? clauseTo.name : null);
  if (outputName) return remember(outputName);
  return remember("result");
}

export async function evoke(sentence) {
  const targetName = sentence?.for?.name ?? sentence?.for?.text ?? null;
  const interpret = await resolveInterpret();
  if (!targetName) {
    const sourceClause = resolveClauseSource(sentence);
    if (!sourceClause) {
      throwErrorSentence({
        name: "evoke clause defective",
        message: "evoke clause defective: missing ob la or caller from la",
        from: { name: "evoke" },
        raw: { sentence }
      });
    }
    const clauseSentence = deepClone(sourceClause);
    if (sentence?.to) clauseSentence.to = deepClone(sentence.to);
    const clauseResult = await interpret(clauseSentence);
    const outFact = outputFactForResult({ outputTo: sentence?.to, clauseTo: clauseSentence?.to });
    if (outFact?.ob) return { ob: outFact.ob, be: outFact.be ?? "text" };
    if (clauseResult?.ob) return { ob: clauseResult.ob, be: clauseResult.be ?? "text" };
    return { ob: { text: "" }, be: "text" };
  }

  const targetFact = remember(targetName);
  const inputOb = sentence?.ob ?? { text: "" };
  const outputTo = sentence?.to ?? { name: "result", nameTypeWords: ["text"] };
  const outputName = outputTo?.name ?? null;
  const withCase = sentence?.with ? { with: sentence.with } : {};
  const byCase = sentence?.by ? { by: sentence.by } : {};
  const atCase = sentence?.at ? { at: sentence.at } : {};
  const underCase = sentence?.under ? { under: sentence.under } : {};

  if (targetFact?.be === "mind") {
    await interpret({
      mood: "do",
      be: "write",
      for: { name: targetName, nameTypeWords: ["mind"] },
      ob: inputOb,
      to: outputTo,
      ...withCase,
      ...byCase,
      ...atCase,
      ...underCase
    });
    const outFact = outputName ? remember(outputName) : remember("result");
    return outFact?.ob ? { ob: outFact.ob, be: outFact.be ?? "text" } : { ob: { text: "" }, be: "text" };
  }

  if (targetFact?.be === "refinery" || targetFact?.as?.name || targetFact?.from?.name || getRefinery(targetName)) {
    const refineryName = resolveRefineryName(targetName);
    await interpret({
      mood: "do",
      be: "refinery",
      from: { name: refineryName, nameTypeWords: ["text"] },
      ob: inputOb,
      to: outputTo,
      ...underCase
    });
    const outFact = outputName ? remember(outputName) : remember("result");
    return outFact?.ob ? { ob: outFact.ob, be: outFact.be ?? "text" } : { ob: { text: "" }, be: "text" };
  }

  await interpret({
    mood: "do",
    be: targetName,
    ob: inputOb,
    to: outputTo,
    ...withCase,
    ...byCase,
    ...atCase,
    ...underCase
  });
  const outFact = outputName ? remember(outputName) : remember("result");
  return outFact?.ob ? { ob: outFact.ob, be: outFact.be ?? "text" } : { ob: { text: "" }, be: "text" };
}

export const signatures = [
  { signatureWords: ["be", "evoke"], handler: evoke },
  { signatureWords: ["be", "evoke", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "ob", "la"], handler: evoke },
  { signatureWords: ["be", "evoke", "ob", "la", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "text", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "text", "ob", "name", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "text", "ob", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "text", "ob", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "num", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "name", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "num", "ob", "name", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "name", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "name", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "text", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "text", "ob", "name", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "num", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "name", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "num", "ob", "name", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "with", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "num", "ob", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "beneath", "name", "map", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "beneath", "name", "text", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "with", "name", "map", "under", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "with", "name", "map", "beneath", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "text", "ob", "text", "to", "name", "text", "with", "name", "map", "beneath", "name", "map"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map", "under", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map", "beneath", "name", "text"], handler: evoke },
  { signatureWords: ["be", "evoke", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map", "beneath", "name", "map"], handler: evoke }
];

export default evoke;
