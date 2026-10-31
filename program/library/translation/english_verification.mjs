export const ENGLISH_VERIFICATION_STATUSES = Object.freeze([
  "accepted-llm",
  "uncertain-llm",
  "rejected-llm"
]);

const VERDICTS = new Set(["accept", "reject", "uncertain"]);
const MAX_RESPONSE_CHARS = 12000;
const MAX_RATIONALE_CHARS = 2000;

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

export function extractBoundedJsonObject(value, { maxResponseChars = MAX_RESPONSE_CHARS } = {}) {
  const source = String(value ?? "").trim();
  if (!source || source.length > maxResponseChars) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu);
  const candidates = fenced ? [fenced[1]] : [];
  if (!fenced) {
    for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            candidates.push(source.slice(start, index + 1));
            break;
          }
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // A caller may perform one bounded repair attempt.
    }
  }
  return null;
}

export function parseBoundedVerificationResponse(value, {
  candidates = [],
  candidateId = (candidate) => text(candidate?.id),
  maxResponseChars = MAX_RESPONSE_CHARS,
  maxRationaleChars = MAX_RATIONALE_CHARS
} = {}) {
  const raw = String(value ?? "");
  if (raw.length > maxResponseChars) return { valid: false, reason: "response exceeds the bounded character limit" };
  let payload = extractBoundedJsonObject(raw, { maxResponseChars });
  if (!payload) return { valid: false, reason: "response did not contain one JSON object" };
  const nestedContent = payload.verdict === undefined && typeof payload.message?.content === "string"
    ? payload.message.content
    : payload.verdict === undefined && typeof payload.response === "string"
      ? payload.response
      : "";
  if (nestedContent) payload = extractBoundedJsonObject(nestedContent, { maxResponseChars }) ?? payload;
  const verdict = text(payload.verdict ?? payload.status).toLowerCase();
  if (!VERDICTS.has(verdict)) return { valid: false, reason: "response verdict must be accept, reject, or uncertain" };
  const rationale = text(payload.rationale ?? payload.reason);
  if (!rationale) return { valid: false, reason: "response rationale is empty" };
  if (rationale.length > maxRationaleChars) return { valid: false, reason: "response rationale exceeds the bounded character limit" };
  const byId = new Map(candidates.map((candidate) => [candidateId(candidate), candidate]));
  const selectedId = text(payload.candidateId ?? payload.candidate_id);
  if (selectedId && !byId.has(selectedId)) return { valid: false, reason: "response candidateId is outside the supplied candidate set" };
  if (verdict === "accept" && !selectedId) return { valid: false, reason: "accepted response must select a supplied candidateId" };
  return {
    valid: true,
    verdict,
    candidateId: selectedId,
    candidate: selectedId ? byId.get(selectedId) : null,
    rationale,
    raw
  };
}

export { MAX_RESPONSE_CHARS, MAX_RATIONALE_CHARS };
