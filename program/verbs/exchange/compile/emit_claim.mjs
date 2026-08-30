import { deriveClaimKey } from "../../../library/knowledge_core.mjs";

const CLAIM_VERBS = new Set(["claim identify", "claim choose"]);

export function handleClaimSentence({
  sentence,
  lang,
  locals,
  localsTypes,
  declared,
  declaredTypes,
  cHelpers,
  jsHelpers
} = {}, { markDeclared, sanitizeName } = {}) {
  if (sentence?.mood !== "do" || !CLAIM_VERBS.has(sentence?.be)) return null;

  const claim = sentence?.ob?.la;
  if (!claim || typeof claim !== "object") {
    throw new Error("claim input defective: ob la claim sentence is required");
  }
  const key = deriveClaimKey(claim);
  const targetName = sentence?.to?.name ?? "result";
  const targetVar = sanitizeName(targetName) || "result";
  const alreadyDeclared = declared?.has(targetName) || declared?.has(targetVar) || locals?.has(targetVar);

  if (lang === "javascript") {
    jsHelpers.usesKnowledgeCore = true;
    const value = sentence.be === "claim identify"
      ? JSON.stringify(key)
      : `__pyaKnowledgeClaimChoose(${JSON.stringify(key)})`;
    const result = `{ su: { name: ${JSON.stringify(targetName)} }, ob: { text: ${value} }, be: "text", mood: "ya" }`;
    const lines = [
      `${alreadyDeclared ? `${targetVar} =` : `let ${targetVar} =`} ${result};`,
      `globalThis[${JSON.stringify(targetName)}] = ${targetVar};`
    ];
    locals?.add(targetVar);
    localsTypes?.set(targetVar, "text");
    declaredTypes?.set(targetName, "text");
    if (!alreadyDeclared) markDeclared(declared, targetName);
    return lines.join("\n");
  }

  if (lang !== "c") return null;
  cHelpers.usesKnowledgeCore = true;
  cHelpers.usesTextHelper = true;
  cHelpers.usesString = true;
  cHelpers.usesPrintf = true;
  cHelpers.usesStdlib = true;
  const source = sentence.be === "claim identify"
    ? JSON.stringify(key)
    : `pya_knowledge_render_current(${JSON.stringify(key)})`;
  const lines = [];
  if (!alreadyDeclared) {
    lines.push(`char ${targetVar}[PYA_TEXT_CAP] = "";`);
    locals?.add(targetVar);
    markDeclared(declared, targetName);
  }
  lines.push(`pya_knowledge_copy(${targetVar}, PYA_TEXT_CAP, ${source}, "claim result");`);
  localsTypes?.set(targetVar, "text");
  declaredTypes?.set(targetName, "text");
  return lines.join("\n");
}
