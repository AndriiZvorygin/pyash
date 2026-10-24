import { createHash } from "node:crypto";

export const TRANSLATION_VOCABULARY_QUEUE_INTENT = "mind";
export const TRANSLATION_VOCABULARY_QUEUE_LANE = "durable";

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-translation-vocabulary-queue";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function candidateIdentity(candidate) {
  return text(candidate?.id) || `${text(candidate?.surface)}:${text(candidate?.sourceRecordId)}`;
}

function promptCandidate(candidate) {
  return {
    id: candidateIdentity(candidate),
    surface: text(candidate?.surface),
    kind: text(candidate?.kind),
    candidateSequences: Array.isArray(candidate?.candidateSequences)
      ? candidate.candidateSequences.map((sequence) => [...sequence])
      : [],
    context: Array.isArray(candidate?.context) ? [...candidate.context] : [],
    evidence: text(candidate?.evidence)
  };
}

export function buildTranslationVocabularyVerificationPrompt({
  language,
  sourceText,
  locator,
  candidates = []
} = {}) {
  if (!text(language)) throw invalid("vocabulary queue prompt requires a source language");
  if (!text(sourceText)) throw invalid("vocabulary queue prompt requires source text");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalid("vocabulary queue prompt requires candidates");
  }
  return [
    "You are the bounded Pyash vocabulary review worker.",
    "Review unresolved source terms from one translation document.",
    "Use the supplied context and evidence to propose existing Pyash atoms, compounds, or grammar mappings.",
    "Keep derivational and grammatical endings separate from lexical heads.",
    "Return exactly one JSON object with this shape:",
    '{"verdict":"complete|partial|uncertain","candidates":[{"id":"...","status":"accept|reject|uncertain","pyashSequence":["..."],"rationale":"..."}]}',
    "Use only supplied candidate ids. Preserve uncertainty when the source evidence does not establish a mapping.",
    `SOURCE LANGUAGE: ${text(language)}`,
    `SOURCE LOCATOR: ${text(locator) || "unavailable"}`,
    "SOURCE TEXT:",
    sourceText,
    "CANDIDATES:",
    candidates.map(promptCandidate).map(JSON.stringify).join("\n")
  ].join("\n");
}

export function translationVocabularyQueueHandle({ sourceHash, candidates = [] } = {}) {
  if (!text(sourceHash)) throw invalid("vocabulary queue handle requires source hash");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalid("vocabulary queue handle requires candidates");
  }
  const identities = candidates.map(candidateIdentity).sort().join("\u0000");
  return `translation-vocabulary-${hash(`${sourceHash}\u0000${identities}`).slice(0, 24)}`;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${text(candidate?.surface).toLowerCase()}\u0000${text(candidate?.kind)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function submitTranslationVocabularyCandidates({
  result,
  sourceText,
  submit,
  submittedAt = new Date().toISOString()
} = {}) {
  if (!result || typeof result !== "object") throw invalid("vocabulary queue requires a translation result");
  if (!text(sourceText)) throw invalid("vocabulary queue requires source text");
  const candidates = Array.isArray(result.vocabularyCandidates) ? result.vocabularyCandidates : [];
  if (candidates.length === 0) {
    return { result, submitted: false, submittedCount: 0, handleId: "", candidates: [] };
  }
  if (typeof submit !== "function") throw invalid("vocabulary queue requires a submit function");
  const batch = uniqueCandidates(candidates);
  const handleId = translationVocabularyQueueHandle({ sourceHash: result.sourceHash, candidates: batch });
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: result.language,
    sourceText,
    locator: result.locator,
    candidates: batch
  });
  const response = await submit({
    handleId,
    prompt,
    candidates: batch,
    result
  });
  const status = text(response?.status || response?.ob?.text).toLowerCase();
  if (status !== "queued") {
    throw invalid("vocabulary queue submission was not accepted", { handleId, response });
  }
  const queue = {
    handleId,
    status: "queued",
    intent: TRANSLATION_VOCABULARY_QUEUE_INTENT,
    lane: TRANSLATION_VOCABULARY_QUEUE_LANE,
    submittedAt,
    candidateCount: batch.length
  };
  return {
    result: {
      ...result,
      vocabularyCandidates: candidates.map((candidate) => ({
        ...candidate,
        queue: {
          ...queue,
          candidateIds: [candidateIdentity(candidate)]
        }
      })),
      vocabularyQueue: queue
    },
    submitted: true,
    submittedCount: batch.length,
    handleId,
    candidates: batch,
    prompt,
    response
  };
}

export function createQueuedMindTranslationVocabularySubmitter({ interpret, parse } = {}) {
  if (typeof interpret !== "function") throw invalid("queued vocabulary submitter requires interpret");
  if (typeof parse !== "function") throw invalid("queued vocabulary submitter requires parse");
  return async ({ handleId, prompt } = {}) => {
    const response = await interpret(parse(
      `su name ${JSON.stringify(handleId)} ob text ${JSON.stringify(String(prompt ?? ""))} vyah start future be gpu mind do`
    ));
    return { ...response, status: text(response?.ob?.text) };
  };
}

export async function createDefaultQueuedMindTranslationVocabularySubmitter(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindTranslationVocabularySubmitter({ interpret, parse, ...options });
}
