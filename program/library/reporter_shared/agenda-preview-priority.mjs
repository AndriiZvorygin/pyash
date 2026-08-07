/**
 * Cross-reporter editorial priority adjustment for agenda-preview highlights.
 * This changes prominence only; every source-backed item remains in the agenda page.
 */
export function agendaPreviewPriorityAdjustment({ title = "", summary = "", sourceText = "" } = {}) {
  const heading = String(title).toLowerCase();
  const hay = `${heading} ${String(summary).toLowerCase()} ${String(sourceText).toLowerCase()}`;
  let score = 0;

  const correspondence = /\bcorrespondence\b|\bletter from\b|\bemail from\b/u.test(heading);
  const delegation = /\b(?:delegation|deputation|presentation)\b/u.test(heading);
  const emptyDelegation = /\b(?:no|none|without)\s+(?:scheduled\s+)?(?:delegations?|deputations?|presentations?)\b/u.test(hay);
  if (delegation) score += emptyDelegation ? -24 : 24;

  if (correspondence) {
    score -= 34;
    if (/\b(?:for information|be received|receipt|receive and file)\b/u.test(hay)) score -= 8;
    if (/\b(?:direction required|request(?:s|ed)? (?:council|support|endorsement)|resolution|endorse|approve|authorize)\b/u.test(hay)) score += 12;
  }

  if (/\b(?:staff report|official plan|budget|capital|tender|award|agreement|by-?law|policy|service change|zoning)\b/u.test(hay)) score += 9;
  if (/\b(?:approve|authorize|award|adopt|amend|direct|fund|purchase|enter into|decision)\b/u.test(hay)) score += 5;
  return score;
}
