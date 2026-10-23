import { englishLemmaCandidateId } from "./english_lemmas.mjs";
import { ENGLISH_VERIFICATION_STATUSES, parseBoundedVerificationResponse } from "./english_verification.mjs";

export const ENGLISH_LEMMA_VERIFICATION_STATUSES = ENGLISH_VERIFICATION_STATUSES;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-lemma-verification";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function candidateId(record) {
  return text(record?.id) || englishLemmaCandidateId(record);
}

function promptRecord(record) {
  return {
    id: candidateId(record),
    surface: record.surface,
    lemma: record.lemma,
    canonicalEnglish: record.canonicalEnglish ?? "",
    pyashSequence: record.pyashSequence ?? [],
    rule: record.rule ?? "",
    evidence: record.evidence ?? "",
    rank: record.rank ?? null
  };
}

export function buildEnglishLemmaVerificationPrompt({ record, candidates = [record] } = {}) {
  if (!record || typeof record !== "object") throw invalid("lemma verification prompt requires a record");
  return [
    "You verify one English surface-form to Pyash lemma mapping.",
    "Choose only among the supplied candidate ids.",
    "Accept an inflectional mapping when the surface is a grammatical form of the candidate lemma.",
    "Keep derivational forms and lexical compounds separate unless the supplied evidence establishes the mapping.",
    "Return exactly one JSON object with verdict, candidateId when accepting, and rationale.",
    '{"verdict":"accept|reject|uncertain","candidateId":"...","rationale":"..."}',
    "SURFACE RECORD:",
    JSON.stringify(promptRecord(record)),
    "CANDIDATES:",
    candidates.map(promptRecord).map(JSON.stringify).join("\n")
  ].join("\n");
}

export function parseEnglishLemmaVerificationResponse(value, { candidates = [] } = {}) {
  return parseBoundedVerificationResponse(value, { candidates, candidateId });
}

function verifiedRecord(record, response, verifierName, attempts) {
  const status = response.verdict === "accept"
    ? "accepted-llm"
    : response.verdict === "reject" ? "rejected-llm" : "uncertain-llm";
  return {
    ...record,
    status,
    verificationStatus: status,
    verifier: verifierName,
    verificationAttempts: attempts,
    verificationRationale: response.rationale,
    ...(response.raw ? { verificationEvidence: response.raw } : {})
  };
}

export async function verifyEnglishLemmaCandidates(records, {
  invoke,
  verifierName = "english lemma verifier",
  maxRepairAttempts = 1,
  onRecord
} = {}) {
  if (!Array.isArray(records)) throw invalid("English lemma verification records must be an array");
  if (records.length > 0 && typeof invoke !== "function") throw invalid("English lemma verification requires an invoke function");
  const repairLimit = Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)));
  const groups = new Map();
  for (const record of records) {
    const key = text(record.surface).toLowerCase();
    const rows = groups.get(key) ?? [];
    rows.push(record);
    groups.set(key, rows);
  }
  const verified = [];
  for (const candidates of groups.values()) {
    const record = candidates[0];
    const prompt = buildEnglishLemmaVerificationPrompt({ record, candidates });
    let attempts = 1;
    let raw = await invoke({ phase: "verify", prompt, record, candidates, attempt: attempts });
    let response = parseEnglishLemmaVerificationResponse(raw, { candidates });
    let repaired = false;
    while (!response.valid && !repaired && repairLimit > 0) {
      repaired = true;
      attempts += 1;
      raw = await invoke({
        phase: "repair",
        prompt: [prompt, "The previous response failed this deterministic contract:", response.reason, "Return one corrected JSON object.", "PREVIOUS RESPONSE:", String(raw ?? "")].join("\n"),
        record,
        candidates,
        attempt: attempts,
        previous: response
      });
      response = parseEnglishLemmaVerificationResponse(raw, { candidates });
    }
    if (!response.valid) {
      response = { verdict: "uncertain", rationale: response.reason, raw: String(raw ?? "") };
    }
    for (const candidate of candidates) {
      const result = response.verdict === "accept" && response.candidateId !== candidateId(candidate)
        ? { verdict: "reject", rationale: `alternative candidate was selected: ${response.rationale}`, raw: response.raw }
        : response;
      const emitted = verifiedRecord(candidate, result, verifierName, attempts);
      verified.push(emitted);
      if (typeof onRecord === "function") await onRecord({ record: emitted, records: [...verified], total: records.length });
    }
  }
  return {
    records: verified,
    accepted: verified.filter((record) => record.verificationStatus === "accepted-llm"),
    uncertain: verified.filter((record) => record.verificationStatus === "uncertain-llm"),
    rejected: verified.filter((record) => record.verificationStatus === "rejected-llm")
  };
}

function queuedHandle(record, phase, attempt) {
  return `english-lemma-verifier-${candidateId(record).replace(/[^a-z0-9._-]+/giu, "-")}-${phase}-${Math.max(1, Math.trunc(Number(attempt) || 1))}`;
}

export function createQueuedMindEnglishLemmaVerifier({ interpret, parse, timeoutMs = 1800000 } = {}) {
  if (typeof interpret !== "function") throw invalid("queued English lemma verifier requires interpret");
  if (typeof parse !== "function") throw invalid("queued English lemma verifier requires parse");
  const waitMs = Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000));
  return async ({ prompt, record, phase = "verify", attempt = 1 } = {}) => {
    const handleId = queuedHandle(record, phase, attempt);
    const start = await interpret(parse(
      `su name ${JSON.stringify(handleId)} ob text ${JSON.stringify(String(prompt ?? ""))} vyah start future be gpu mind do`
    ));
    if (String(start?.ob?.text ?? "").trim() !== "queued") {
      throw invalid("queued English lemma verifier did not receive a queued duty", { handleId, start });
    }
    const completed = await interpret(parse(
      `accordingto text ${JSON.stringify(handleId)} during num ${waitMs} vyah await be gpu do`
    ));
    if (String(completed?.ob?.text ?? "").trim() !== "success") {
      throw invalid("queued English lemma verifier duty did not complete successfully", { handleId, completed });
    }
    return String(completed?.result?.text ?? "");
  };
}

export async function createDefaultQueuedMindEnglishLemmaVerifier(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindEnglishLemmaVerifier({ interpret, parse, ...options });
}
