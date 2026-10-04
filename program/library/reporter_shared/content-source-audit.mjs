import {
  unsupportedAgendaRoles,
  unsupportedCivicOutcomeVerbs,
} from "./civic-sentence-boundaries.mjs";

function normalizeSources(sourceTexts) {
  return (Array.isArray(sourceTexts) ? sourceTexts : [sourceTexts])
    .map((source) => String(source || "").replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

/**
 * Check generated claim language against the complete source set used for the
 * field. Role classification alone is too coarse: a whole-meeting source can
 * contain both procedural language and a supported decision, while a teaser
 * may legitimately mention that decision. The source-aware verb/role checks
 * preserve the fail-closed contract without rejecting that valid composition.
 */
export function auditRenderedContent({ renderedText = "", sourceTexts = [] } = {}) {
  const sources = normalizeSources(sourceTexts);
  const unsupportedOutcomeVerbs = unsupportedCivicOutcomeVerbs(renderedText, sources);
  const unsupportedRoles = unsupportedAgendaRoles(renderedText, sources);
  return {
    unsupportedOutcomeVerbs,
    unsupportedRoles,
    roleUpgradeDetected: unsupportedOutcomeVerbs.length > 0 || unsupportedRoles.length > 0,
  };
}
