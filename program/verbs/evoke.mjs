import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getRefinery } from "../bridge/refinery.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function resolveRefineryName(targetName) {
  const fact = remember(targetName);
  if (fact?.as?.name) return fact.as.name;
  if (fact?.from?.name) return fact.from.name;
  return targetName;
}

export async function evoke(sentence) {
  const targetName = sentence?.for?.name ?? sentence?.for?.text ?? null;
  if (!targetName) {
    throwErrorSentence({
      name: "evoke target defective",
      message: "evoke target defective: missing for name",
      from: { name: "evoke" },
      raw: { sentence }
    });
  }

  const targetFact = remember(targetName);
  const interpret = await resolveInterpret();
  const inputOb = sentence?.ob ?? { text: "" };
  const outputTo = sentence?.to ?? { name: "result", nameTypeWords: ["text"] };
  const outputName = outputTo?.name ?? null;
  const withCase = sentence?.with ? { with: sentence.with } : {};
  const byCase = sentence?.by ? { by: sentence.by } : {};
  const atCase = sentence?.at ? { at: sentence.at } : {};

  if (targetFact?.be === "mind") {
    await interpret({
      mood: "do",
      be: "write",
      for: { name: targetName, nameTypeWords: ["mind"] },
      ob: inputOb,
      to: outputTo,
      ...withCase,
      ...byCase,
      ...atCase
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
      to: outputTo
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
    ...atCase
  });
  const outFact = outputName ? remember(outputName) : remember("result");
  return outFact?.ob ? { ob: outFact.ob, be: outFact.be ?? "text" } : { ob: { text: "" }, be: "text" };
}

export const signatures = [
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
  { signatureWords: ["be", "evoke", "for", "name", "refinery", "ob", "text"], handler: evoke }
];

export default evoke;
