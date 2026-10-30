import { createHash } from "node:crypto";

import { parseBoundedVerificationResponse } from "./english_verification.mjs";

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-sentence-verification";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
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

function queuedHandle(sourceText, attempt) {
  const identity = createHash("sha256").update(String(sourceText ?? "")).digest("hex").slice(0, 24);
  return `english-sentence-verifier-${identity}-verify-${Math.max(1, Math.trunc(Number(attempt) || 1))}`;
}

export function createQueuedMindEnglishSentenceVerifier({ interpret, parse, timeoutMs = 1800000 } = {}) {
  if (typeof interpret !== "function") throw invalid("queued English sentence verifier requires interpret");
  if (typeof parse !== "function") throw invalid("queued English sentence verifier requires parse");
  const waitMs = Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000));
  return async ({ sourceText, prompt, attempt = 1 } = {}) => {
    const handleId = queuedHandle(sourceText, attempt);
    const start = await interpret(parse(
      `su name ${JSON.stringify(handleId)} ob text ${JSON.stringify(String(prompt ?? ""))} vyah start future be gpu mind do`
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
    return String(completed?.result?.text ?? "");
  };
}

export async function createDefaultQueuedMindEnglishSentenceVerifier(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../bridge/index.mjs"),
    import("../../understand/index.mjs")
  ]);
  return createQueuedMindEnglishSentenceVerifier({ interpret, parse, ...options });
}
