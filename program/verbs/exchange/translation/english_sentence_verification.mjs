import { createHash } from "node:crypto";

import {
  extractBoundedJsonObject,
  parseBoundedVerificationResponse
} from "./english_verification.mjs";

const MAX_QUEUED_MIND_ENVELOPE_CHARS = 256000;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-sentence-verification";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function queuedMindAnswer(value) {
  const raw = String(value ?? "");
  if (raw.length > MAX_QUEUED_MIND_ENVELOPE_CHARS) {
    return "provider response envelope exceeds the bounded limit";
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return raw;
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const answer = [
    payload.response,
    payload.output_text,
    payload.output,
    payload.text,
    payload.message?.content,
    choice?.message?.content,
    choice?.text
  ].find((candidate) => typeof candidate === "string");
  return answer ?? raw;
}

function candidateId(candidate) {
  return text(candidate?.id) || `english-sentence-${createHash("sha256").update(JSON.stringify(candidate ?? {})).digest("hex").slice(0, 24)}`;
}

function promptCandidate(candidate) {
  return {
    id: candidateId(candidate),
    phrase: candidate?.phrase ?? "",
    lemma: candidate?.lemma ?? "",
    pyashSequence: candidate?.pyashSequence ?? [],
    markerNames: candidate?.markerNames ?? [],
    certainty: candidate?.certainty ?? "",
    evidence: candidate?.evidence ?? ""
  };
}

export function buildEnglishSentenceVerificationPrompt({ sourceText, analysis, candidates = [] } = {}) {
  if (!text(sourceText)) throw invalid("sentence verification prompt requires source text");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalid("sentence verification prompt requires candidates");
  }
  return [
    "You verify one English sentence morphology analysis for Pyash.",
    "Choose only among the supplied candidate ids.",
    "Use the sentence context to distinguish tense, aspect, auxiliaries, and participles.",
    "Return exactly one JSON object with verdict, candidateId when accepting, and rationale.",
    '{"verdict":"accept|reject|uncertain","candidateId":"...","rationale":"..."}',
    "SOURCE SENTENCE:",
    sourceText,
    "ANALYSIS:",
    JSON.stringify({
      status: analysis?.status ?? "review",
      unresolved: analysis?.unresolved ?? [],
      tokens: analysis?.tokens ?? []
    }),
    "CANDIDATES:",
    candidates.map(promptCandidate).map(JSON.stringify).join("\n")
  ].join("\n");
}

export function parseEnglishSentenceVerificationResponse(value, { candidates = [] } = {}) {
  return parseBoundedVerificationResponse(value, { candidates, candidateId });
}

export async function verifyEnglishSentenceCandidates({ sourceText, analysis, candidates = [], invoke, verifierName = "english sentence verifier", maxRepairAttempts = 1 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalid("sentence verification requires candidates");
  }
  if (typeof invoke !== "function") throw invalid("sentence verification requires an invoke function");
  const repairLimit = Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)));
  const prompt = buildEnglishSentenceVerificationPrompt({ sourceText, analysis, candidates });
  let attempts = 1;
  let raw = await invoke({ phase: "verify", prompt, sourceText, analysis, candidates, attempt: attempts });
  let response = parseEnglishSentenceVerificationResponse(raw, { candidates });
  let repaired = false;
  while (!response.valid && !repaired && repairLimit > 0) {
    repaired = true;
    attempts += 1;
    raw = await invoke({
      phase: "repair",
      prompt: [prompt, "The previous response failed this deterministic contract:", response.reason, "Return one corrected JSON object.", "PREVIOUS RESPONSE:", String(raw ?? "")].join("\n"),
      sourceText,
      analysis,
      candidates,
      attempt: attempts,
      previous: response
    });
    response = parseEnglishSentenceVerificationResponse(raw, { candidates });
  }
  if (!response.valid) {
    response = {
      valid: true,
      verdict: "uncertain",
      candidateId: "",
      candidate: null,
      rationale: response.reason,
      raw: String(raw ?? "")
    };
  }
  return {
    ...response,
    sourceText,
    verifier: verifierName,
    verificationAttempts: attempts,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      id: candidateId(candidate),
      verificationStatus: response.verdict === "accept" && response.candidateId === candidateId(candidate)
        ? "accepted-llm"
        : response.verdict === "reject" ? "rejected-llm" : "uncertain-llm",
      verificationRationale: response.rationale,
      ...(response.raw ? { verificationEvidence: response.raw } : {})
    }))
  };
}

function phraseDecisionOptions(coordination) {
  return (coordination?.decision?.caseTargets ?? []).map((target) => ({
    itemId: target.itemId,
    phrase: target.surface,
    options: (target.options ?? []).map(({ id, context, role, pya }) => ({ id, context, role, pya }))
  }));
}

export function buildEnglishPhraseCoordinationPrompt({ sourceText, coordination } = {}) {
  const decision = coordination?.decision;
  if (!text(sourceText) || !decision?.factorizationId) {
    throw invalid("phrase-list verification requires source text and a factorization candidate");
  }
  return [
    "Choose the supplied phrase-list factorization and target cases for one English sentence.",
    "Use only the listed ids. Keep the shared lexical head after the coordinated members.",
    "For each directional target, choose the destination case that matches its semantic role.",
    "Keep the rationale to one short sentence, at most 200 characters.",
    "Return one JSON object only:",
    '{"verdict":"accept|uncertain","factorizationId":"...","targetCases":[{"itemId":"...","caseId":"..."}],"rationale":"..."}',
    "SOURCE SENTENCE:",
    sourceText,
    "SHARED HEAD:",
    JSON.stringify({
      id: decision.factorizationId,
      surface: coordination.factorization?.head?.surface ?? "",
      pyashSequence: coordination.factorization?.head?.pyashSequence ?? []
    }),
    "DIRECTIONAL TARGETS AND CASE OPTIONS:",
    JSON.stringify(phraseDecisionOptions(coordination))
  ].join("\n");
}

export function parseEnglishPhraseCoordinationResponse(value, { coordination } = {}) {
  const raw = String(value ?? "");
  const payload = extractBoundedJsonObject(raw);
  if (!payload) return { valid: false, reason: "response did not contain a JSON object" };
  const decision = coordination?.decision;
  const verdict = text(payload.verdict ?? payload.status).toLowerCase();
  if (!decision?.factorizationId) return { valid: false, reason: "phrase-list candidate is missing" };
  if (!new Set(["accept", "uncertain", "reject"]).has(verdict)) {
    return { valid: false, reason: "verdict must be accept, reject, or uncertain" };
  }
  const rationale = text(payload.rationale ?? payload.reason);
  if (!rationale || rationale.length > 500) return { valid: false, reason: "rationale is empty or too long" };
  if (verdict !== "accept") return { valid: true, verdict, rationale, raw, targetCases: [] };
  if (text(payload.factorizationId) !== decision.factorizationId) {
    return { valid: false, reason: "factorization id is outside the supplied candidate" };
  }
  if (!Array.isArray(payload.targetCases)) return { valid: false, reason: "targetCases must be an array" };
  const expected = new Map((decision.caseTargets ?? []).map((target) => [target.itemId, target]));
  const selected = new Map();
  for (const row of payload.targetCases) {
    const itemId = text(row?.itemId);
    const caseId = text(row?.caseId);
    const target = expected.get(itemId);
    if (!target || selected.has(itemId)) return { valid: false, reason: "target item id is missing, duplicated, or unknown" };
    const option = target.options.find((candidate) => candidate.id === caseId);
    if (!option) return { valid: false, reason: "case id is outside the supplied options" };
    selected.set(itemId, { itemId, caseId, pya: option.pya, context: option.context, role: option.role });
  }
  if (selected.size !== expected.size) return { valid: false, reason: "every directional target must receive one case" };
  return {
    valid: true,
    verdict,
    factorizationId: decision.factorizationId,
    targetCases: [...selected.values()],
    rationale,
    raw
  };
}

export async function verifyEnglishPhraseCoordination({
  sourceText,
  coordination,
  invoke,
  verifierName = "English phrase-list verifier",
  maxRepairAttempts = 1
} = {}) {
  if (typeof invoke !== "function") throw invalid("phrase-list verification requires an invoke function");
  const prompt = buildEnglishPhraseCoordinationPrompt({ sourceText, coordination });
  const repairLimit = Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)));
  let attempts = 1;
  let raw = await invoke({ phase: "verify", prompt, sourceText, coordination, attempt: attempts });
  let response = parseEnglishPhraseCoordinationResponse(raw, { coordination });
  if (!response.valid && repairLimit > 0) {
    attempts += 1;
    raw = await invoke({
      phase: "repair",
      prompt: [prompt, "The previous response failed this contract:", response.reason, "Return only corrected JSON.", "PREVIOUS RESPONSE:", String(raw ?? "")].join("\n"),
      sourceText,
      coordination,
      attempt: attempts,
      previous: response
    });
    response = parseEnglishPhraseCoordinationResponse(raw, { coordination });
  }
  if (!response.valid) {
    return {
      verdict: "uncertain",
      factorizationId: "",
      targetCases: [],
      rationale: response.reason,
      raw: String(raw ?? ""),
      verifier: verifierName,
      verificationAttempts: attempts
    };
  }
  return { ...response, verifier: verifierName, verificationAttempts: attempts };
}

export function createMemoizedEnglishPhraseCoordinationVerifier({ invoke } = {}) {
  if (typeof invoke !== "function") throw invalid("memoized phrase-list verifier requires an invoke function");
  const decisions = new Map();
  return (request = {}) => {
    const coordination = request.analysis?.phraseCoordination ?? request.coordination;
    const factorizationId = coordination?.decision?.factorizationId;
    const sourceText = text(request.sourceText);
    if (!sourceText || !factorizationId) {
      throw invalid("memoized phrase-list verifier requires source text and a factorization id");
    }
    const key = `${sourceText}\u0000${factorizationId}`;
    if (decisions.has(key)) return decisions.get(key);
    const pending = verifyEnglishPhraseCoordination({
      sourceText,
      coordination,
      invoke
    }).catch((error) => {
      decisions.delete(key);
      throw error;
    });
    decisions.set(key, pending);
    return pending;
  };
}

function queuedHandle(sourceText, attempt, factorizationId = "") {
  const identitySource = factorizationId
    ? JSON.stringify([String(sourceText ?? ""), String(factorizationId)])
    : String(sourceText ?? "");
  const identity = createHash("sha256").update(identitySource).digest("hex").slice(0, 24);
  return `english-sentence-verifier-${identity}-verify-${Math.max(1, Math.trunc(Number(attempt) || 1))}`;
}

export function createQueuedMindEnglishSentenceVerifier({ interpret, parse, timeoutMs = 1800000 } = {}) {
  if (typeof interpret !== "function") throw invalid("queued English sentence verifier requires interpret");
  if (typeof parse !== "function") throw invalid("queued English sentence verifier requires parse");
  const waitMs = Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000));
  return async ({ sourceText, prompt, attempt = 1, coordination } = {}) => {
    const handleId = queuedHandle(sourceText, attempt, coordination?.decision?.factorizationId);
    const jobSpec = JSON.stringify({
      kind: "ollama-generate",
      prompt: String(prompt ?? ""),
      stream: false,
      think: false,
      format: "json",
      options: { num_predict: 512 }
    });
    const start = await interpret(parse(
      `su name ${JSON.stringify(handleId)} ob text ${JSON.stringify(jobSpec)} vyah start future be gpu mind do`
    ));
    if (String(start?.ob?.text ?? "").trim() !== "queued") {
      throw invalid("queued English sentence verifier did not receive a queued duty", { handleId, start });
    }
    const completed = await interpret(parse(
      `accordingto text ${JSON.stringify(handleId)} during num ${waitMs} vyah await be gpu do`
    ));
    if (String(completed?.ob?.text ?? "").trim() !== "success") {
      throw invalid("queued English sentence verifier duty did not complete successfully", { handleId, completed });
    }
    return queuedMindAnswer(completed?.result?.text ?? "");
  };
}

export async function createDefaultQueuedMindEnglishSentenceVerifier(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindEnglishSentenceVerifier({ interpret, parse, ...options });
}
