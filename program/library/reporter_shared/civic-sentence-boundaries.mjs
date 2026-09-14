const PERIOD_MARKER = "\uE000";

const CIVIC_ABBREVIATION_PATTERN = /\b(No|Nos|Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Hon|vs|etc|e\.g|i\.e|approx|sec|secs|art|arts)\./giu;

function protectCivicAbbreviations(text = "") {
  return String(text || "")
    .replace(CIVIC_ABBREVIATION_PATTERN, (_, abbreviation) => `${abbreviation}${PERIOD_MARKER}`)
    .replace(/\b([A-Z])\./gu, (_, initial) => `${initial}${PERIOD_MARKER}`);
}

export function splitCivicSentences(text = "") {
  const protectedText = protectCivicAbbreviations(text);
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .map((part) => part.replaceAll(PERIOD_MARKER, ".").trim())
    .filter(Boolean);
}

export function extractCivicLeadingSentence(text = "") {
  const compact = String(text || "").replace(/\s+/gu, " ").trim();
  if (!compact) return "";
  const abbreviations = new Set([
    "no.", "nos.", "mr.", "mrs.", "ms.", "dr.", "st.", "mt.", "jr.", "sr.", "hon.",
    "vs.", "etc.", "e.g.", "i.e.", "approx.", "sec.", "secs.", "art.", "arts.",
    "jan.", "feb.", "mar.", "apr.", "jun.", "jul.", "aug.", "sep.", "sept.", "oct.", "nov.", "dec.",
  ]);
  for (let i = 0; i < compact.length; i += 1) {
    const ch = compact[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const head = compact.slice(0, i + 1).trim();
    const tail = compact.slice(i + 1).trimStart();
    const lastToken = (head.split(/\s+/u).pop() || "").toLowerCase();
    if (ch === "." && /\d/u.test(compact.charAt(i - 1)) && /\d/u.test(compact.charAt(i + 1))) continue;
    if (ch === "." && (abbreviations.has(lastToken) || /^[a-z]\.$/u.test(lastToken))) continue;
    if (!tail) return head;
    // A verifier may append the next source bullet after a valid sentence.
    // Treat that formatting boundary as the end of the candidate sentence.
    if (/^(?:[-*•]\s+|\d+[.)]\s+|\[[^\]]+\]\s+)/u.test(tail)) return head;
    if (/[A-Z0-9"'“”(]/u.test(tail.charAt(0))) return head;
  }
  return compact;
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
