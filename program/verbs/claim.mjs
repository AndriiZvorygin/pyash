import { deriveClaimKey, resolveKnowledgeView } from "../library/knowledge_core.mjs";

function claimInput(sentence) {
  const claim = sentence?.ob?.la;
  if (!claim || typeof claim !== "object") {
    throw new Error("claim input defective: ob la claim sentence is required");
  }
  return claim;
}

export function claimIdentify(sentence) {
  return { ob: { text: deriveClaimKey(claimInput(sentence)) }, be: "text" };
}

export function claimChoose(sentence, { allRemember = () => [] } = {}) {
  const key = deriveClaimKey(claimInput(sentence));
  const view = resolveKnowledgeView(allRemember(), key);
  return { ob: { text: JSON.stringify(view) }, be: "text" };
}

export const signatures = [
  { signatureWords: ["be", "claim", "identify"], handler: claimIdentify },
  { signatureWords: ["be", "claim", "identify", "ob", "la"], handler: claimIdentify },
  { signatureWords: ["be", "claim", "choose"], handler: claimChoose },
  { signatureWords: ["be", "claim", "choose", "ob", "la"], handler: claimChoose }
];
