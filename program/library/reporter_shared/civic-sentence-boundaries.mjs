const PERIOD_MARKER = "\uE000";

export function splitCivicSentences(text = "") {
  const protectedText = String(text || "")
    .replace(
      /\b(No|Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Hon|vs|etc)\./giu,
      (_, abbreviation) => `${abbreviation}${PERIOD_MARKER}`,
    )
    .replace(/\b([A-Z])\./gu, (_, initial) => `${initial}${PERIOD_MARKER}`);
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .map((part) => part.replaceAll(PERIOD_MARKER, ".").trim())
    .filter(Boolean);
}

const OUTCOME_VERB_FAMILIES = [
  { generated: /\bapproved\b/iu, source: /\bapprov(?:e|ed|al)\b/iu, label: "approved" },
  { generated: /\badopted\b/iu, source: /\badopt(?:ed|ion)\b/iu, label: "adopted" },
  { generated: /\bpassed\b/iu, source: /\bpass(?:ed|age)\b/iu, label: "passed" },
  { generated: /\brejected\b/iu, source: /\breject(?:ed|ion)\b/iu, label: "rejected" },
  { generated: /\bdirected\b/iu, source: /\bdirect(?:ed|ion)\b/iu, label: "directed" },
  { generated: /\bauthorized\b/iu, source: /\bauthoriz(?:ed|ation)\b/iu, label: "authorized" },
];

export function unsupportedCivicOutcomeVerbs(generated = "", groundedSources = []) {
  const source = (Array.isArray(groundedSources) ? groundedSources : [groundedSources])
    .map(String)
    .join("\n");
  return OUTCOME_VERB_FAMILIES
    .filter((family) => family.generated.test(String(generated || "")) && !family.source.test(source))
    .map((family) => family.label);
}

const AGENDA_ROLE_TERMS = ["deputation", "presentation", "public forum", "public meeting"];

export function agendaRoleConstraint(authoritativeHeadings = []) {
  const headings = (Array.isArray(authoritativeHeadings) ? authoritativeHeadings : [authoritativeHeadings])
    .map(String)
    .join("\n")
    .toLowerCase();
  const forbidden = AGENDA_ROLE_TERMS.filter((role) => !headings.includes(role));
  return forbidden.length
    ? `Do not use these agenda-role terms: ${forbidden.join(", ")}.`
    : "";
}

export function unsupportedAgendaRoles(generated = "", authoritativeHeadings = []) {
  const candidate = String(generated || "").toLowerCase();
  const headings = (Array.isArray(authoritativeHeadings) ? authoritativeHeadings : [authoritativeHeadings])
    .map(String)
    .join("\n")
    .toLowerCase();
  return AGENDA_ROLE_TERMS.filter((role) => candidate.includes(role) && !headings.includes(role));
}
