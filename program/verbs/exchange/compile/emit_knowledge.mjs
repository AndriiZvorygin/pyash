import {
  isEvidenceSentence,
  canonicalJson,
  normalizeClaimSentence,
  normalizeEvidence
} from "../../../library/knowledge_core.mjs";

export function handleKnowledgeSentence({
  sentence,
  lang,
  locals,
  localsTypes,
  declared,
  declaredTypes,
  cHelpers,
  jsHelpers
} = {}, { markDeclared, sanitizeName } = {}) {
  if (sentence?.mood !== "ya" || !isEvidenceSentence(sentence)) return null;

  const normalized = normalizeClaimSentence(sentence);
  const evidence = normalizeEvidence(normalized);
  if (lang === "javascript") {
    jsHelpers.usesKnowledgeCore = true;
    const name = normalized.su.name;
    const safeName = sanitizeName(name);
    const alreadyDeclared = declared?.has(name) || locals?.has(safeName);
    const sentenceText = JSON.stringify(normalized);
    if (!alreadyDeclared) {
      markDeclared(declared, name);
      locals?.add(safeName);
      localsTypes?.set(safeName, "text");
      declaredTypes?.set(name, "text");
      return `let ${safeName} = ${sentenceText};\nglobalThis[${JSON.stringify(name)}] = ${safeName};\n__pyaKnowledgeAdd(${safeName});`;
    }
    return `${safeName} = ${sentenceText};\nglobalThis[${JSON.stringify(name)}] = ${safeName};\n__pyaKnowledgeAdd(${safeName});`;
  }

  if (lang !== "c") return null;
  cHelpers.usesKnowledgeCore = true;
  cHelpers.usesTextHelper = true;
  cHelpers.usesString = true;
  cHelpers.usesPrintf = true;
  cHelpers.usesStdlib = true;
  const payload = JSON.stringify(JSON.stringify(canonicalJson(normalized.ob ?? { hollow: true })));
  return `pya_knowledge_add(${JSON.stringify(evidence.key)}, ${payload}, ${JSON.stringify(evidence.evidential)}, ${evidence.confidence ?? -1}, ${JSON.stringify(evidence.anchorId ?? "")}, ${JSON.stringify(evidence.sentence)});`;
}
