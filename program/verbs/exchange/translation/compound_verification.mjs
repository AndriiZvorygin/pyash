const DETERMINISTIC_STATUSES = new Set(["accepted-delimited", "accepted-curated"]);
const UNCERTAIN_STATUSES = new Set(["candidate-closed"]);

export const COMPOUND_VERIFICATION_STATUSES = Object.freeze([
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm",
  "uncertain-llm",
  "rejected-deterministic",
  "rejected-llm"
]);

const RESPONSE_VERDICTS = new Set(["accept", "reject", "uncertain"]);
const RESPONSE_HEAD_KINDS = new Set([
  "lexical-head",
  "derivational-ending",
  "grammatical-ending",
  "uncertain"
]);
const MAX_RESPONSE_CHARS = 12000;
const MAX_RATIONALE_CHARS = 2000;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-compound-verification";
  error.details = details;
  return error;
}

function normalizeText(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function candidateId(record) {
  return normalizeText(record?.id) || [
    normalizeText(record?.target),
    Array.isArray(record?.pyashSequence) ? record.pyashSequence.join(" ") : ""
  ].join("|");
}

function isValidLayerShape(record) {
  return Boolean(
    Array.isArray(record?.componentLayers) &&
    Array.isArray(record?.pyashSequence) &&
    record.componentLayers.length === record.pyashSequence.length &&
    record.componentLayers.length >= 2 &&
    record.componentLayers.every((layer) => Number.isInteger(layer) && layer >= 1) &&
    Number.isInteger(record.maxLayer) &&
    record.maxLayer === Math.max(...record.componentLayers)
  );
}

function isValidSemanticShape(record) {
  return Boolean(
    Array.isArray(record?.componentGlosses) &&
    record.componentGlosses.length >= 2 &&
    record.componentGlosses.length === record.pyashSequence?.length &&
    record.componentGlosses.every((gloss) => normalizeText(gloss)) &&
    normalizeText(record.head) === normalizeText(record.componentGlosses.at(-1))
  );
}

function endsAtKnownMorphologyMarker(record) {
  return record?.status === "candidate-closed" &&
    Array.isArray(record?.morphologySignals) &&
    record.morphologySignals.some((signal) => signal?.boundary === "component");
}

function deterministicChecks(record) {
  const sourceBoundary = record?.status === "accepted-delimited" || record?.status === "accepted-curated";
  const atomicComponents = Array.isArray(record?.pyashSequence) &&
    record.pyashSequence.length >= 2 &&
    record.pyashSequence.every((word) => normalizeText(word));
  const layerMetadata = isValidLayerShape(record);
  const semanticHead = isValidSemanticShape(record);
  const checks = {
    sourceBoundary,
    atomicComponents,
    layerMetadata,
    semanticHead
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

function certaintyScore(checks) {
  const weights = {
    sourceBoundary: 0.35,
    atomicComponents: 0.25,
    layerMetadata: 0.2,
    semanticHead: 0.2
  };
  return Number(Object.entries(checks)
    .reduce((score, [name, passed]) => score + (passed ? weights[name] : 0), 0)
    .toFixed(2));
}

export function classifyCompoundCertainty(record) {
  if (!record || typeof record !== "object") {
    return {
      certainty: "deterministic",
      certaintyScore: 0,
      verificationStatus: "rejected-deterministic",
      reasons: ["record is missing"]
    };
  }
  const { checks, passed } = deterministicChecks(record);
  const score = certaintyScore(checks);
  if (DETERMINISTIC_STATUSES.has(record.status) && passed) {
    return {
      certainty: "deterministic",
      certaintyScore: 1,
      verificationStatus: "accepted-deterministic",
      deterministicChecks: checks,
      reasons: ["explicit or curated source decomposition", "existing atomic components", "valid Pyac layers", "head-final semantic shape"]
    };
  }
  if (DETERMINISTIC_STATUSES.has(record.status)) {
    return {
      certainty: "deterministic",
      certaintyScore: score,
      verificationStatus: "rejected-deterministic",
      deterministicChecks: checks,
      reasons: Object.entries(checks)
        .filter(([, passedCheck]) => !passedCheck)
        .map(([name]) => `${name} check failed`)
    };
  }
  if (UNCERTAIN_STATUSES.has(record.status)) {
    if (endsAtKnownMorphologyMarker(record)) {
      return {
        certainty: "deterministic",
        certaintyScore: score,
        verificationStatus: "rejected-deterministic",
        deterministicChecks: checks,
        reasons: ["closed-word segmentation terminates at a known derivational or grammatical ending"]
      };
    }
    return {
      certainty: "llm",
      certaintyScore: score,
      verificationStatus: "uncertain-llm",
      deterministicChecks: checks,
      reasons: ["closed-word segmentation has semantic uncertainty", "LLM selection is limited to this candidate"]
    };
  }
  return {
    certainty: "deterministic",
    certaintyScore: score,
    verificationStatus: "rejected-deterministic",
    deterministicChecks: checks,
    reasons: ["unsupported compound coverage status"]
  };
}

export function classifyCompoundCoverage(records) {
  if (!Array.isArray(records)) throw invalid("compound certainty requires records");
  const classified = records.map((record) => ({
    ...record,
    ...classifyCompoundCertainty(record)
  }));
  return {
    records: classified,
    deterministic: classified.filter((record) => record.certainty === "deterministic"),
    verificationCandidates: classified.filter((record) => record.certainty === "llm"),
    rejected: classified.filter((record) => record.verificationStatus === "rejected-deterministic")
  };
}

function jsonForPrompt(value) {
  return JSON.stringify({
    id: candidateId(value),
    target: value.target,
    sourceSurfaces: value.sourceSurfaces ?? {},
    sourceMorphemesByLanguage: value.sourceMorphemesByLanguage ?? {},
    sourceMorphemes: value.sourceMorphemes ?? value.morphemes ?? [],
    componentGlosses: value.componentGlosses ?? [],
    pyashSequence: value.pyashSequence ?? [],
    head: value.head ?? "",
    modifiers: value.modifiers ?? [],
    componentRoles: value.componentRoles ?? [],
    morphologyStatus: value.morphologyStatus ?? "",
    morphologySignals: value.morphologySignals ?? [],
    componentLayers: value.componentLayers ?? [],
    evidence: value.evidence ?? "",
    deterministicChecks: value.deterministicChecks ?? {}
  });
}

export function buildCompoundVerificationPrompt({ record, candidates = [record] } = {}) {
  if (!record || typeof record !== "object") throw invalid("compound verification prompt requires a record");
  const candidateRows = candidates
    .filter((candidate) => candidate && typeof candidate === "object")
    .map(jsonForPrompt)
    .join("\n");
  return [
    "You verify a Pyash compound candidate.",
    "Choose only one candidate id supplied below.",
    "Use the source evidence to judge whether the components compose the target meaning.",
    "Pyash order is head-final: the final component is the semantic head.",
    "Spelling overlap is not a semantic boundary. Classify the final component as lexical-head only when the target denotes a kind of that component.",
    "A derivational or grammatical ending is a separate morphology signal, even when it matches an atomic English word.",
    "For example, acceptant is not a kind of ant, and zincking is not a kind of king.",
    "Return one JSON object with exactly these useful fields:",
    '{"verdict":"accept|reject|uncertain","candidateId":"...","headKind":"lexical-head|derivational-ending|grammatical-ending|uncertain","rationale":"..."}',
    "A valid accept must use a supplied candidateId, preserve its component sequence, and set headKind to lexical-head.",
    "\nTARGET RECORD:",
    jsonForPrompt(record),
    "\nCANDIDATES:",
    candidateRows
  ].join("\n");
}

function extractJsonObject(text) {
  const source = String(text ?? "").trim();
  if (!source) return null;
  if (source.length > MAX_RESPONSE_CHARS) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu);
  const candidates = fenced ? [fenced[1]] : [source];
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
      // A bounded repair attempt is handled by the caller.
    }
  }
  return null;
}

export function parseCompoundVerificationResponse(text, { candidates = [] } = {}) {
  if (String(text ?? "").length > MAX_RESPONSE_CHARS) {
    return { valid: false, reason: "response exceeds the bounded character limit" };
  }
  let payload = extractJsonObject(text);
  if (!payload) return { valid: false, reason: "response did not contain one JSON object" };
  const nestedContent = payload.verdict === undefined && typeof payload.message?.content === "string"
    ? payload.message.content
    : payload.verdict === undefined && typeof payload.response === "string"
      ? payload.response
      : "";
  if (nestedContent && nestedContent.length <= MAX_RESPONSE_CHARS) {
    const nested = extractJsonObject(nestedContent);
    if (nested) payload = nested;
  }
  const verdict = normalizeText(payload.verdict ?? payload.status).toLowerCase();
  if (!RESPONSE_VERDICTS.has(verdict)) {
    return { valid: false, reason: "response verdict must be accept, reject, or uncertain" };
  }
  const rationale = normalizeText(payload.rationale ?? payload.reason);
  if (!rationale) return { valid: false, reason: "response rationale is empty" };
  if (rationale.length > MAX_RATIONALE_CHARS) {
    return { valid: false, reason: "response rationale exceeds the bounded character limit" };
  }
  const candidateMap = new Map(candidates.map((candidate) => [candidateId(candidate), candidate]));
  const selectedId = normalizeText(payload.candidateId ?? payload.candidate_id);
  if (selectedId && !candidateMap.has(selectedId)) {
    return { valid: false, reason: "response candidateId is outside the supplied candidate set" };
  }
  if (verdict === "accept") {
    if (!selectedId || !candidateMap.has(selectedId)) {
      return { valid: false, reason: "accepted response must select a supplied candidateId" };
    }
  }
  const headKind = normalizeText(payload.headKind ?? payload.head_kind).toLowerCase();
  if (verdict === "accept" && !RESPONSE_HEAD_KINDS.has(headKind)) {
    return { valid: false, reason: "accepted response must classify the final component as lexical-head, derivational-ending, or grammatical-ending" };
  }
  if (headKind && !RESPONSE_HEAD_KINDS.has(headKind)) {
    return { valid: false, reason: "response headKind is unsupported" };
  }
  return {
    valid: true,
    verdict,
    candidate: selectedId ? candidateMap.get(selectedId) : null,
    candidateId: selectedId,
    headKind: headKind || "uncertain",
    rationale,
    raw: String(text ?? "")
  };
}

function applyVerification(record, classification, response, {
  verifierName,
  attempts,
  repaired = false
} = {}) {
  const selected = response.candidate ?? record;
  const status = response.verdict === "accept"
    ? (repaired ? "repaired-llm" : "accepted-llm")
    : response.verdict === "reject" ? "rejected-llm" : "uncertain-llm";
  return {
    ...selected,
    coverageStatus: selected.status,
    status,
    verificationStatus: status,
    certainty: "llm",
    certaintyScore: classification.certaintyScore,
    deterministicChecks: classification.deterministicChecks,
    verificationAttempts: attempts,
    verifier: verifierName,
    verificationRationale: response.rationale,
    verificationHeadKind: response.headKind,
    ...(response.raw ? { verificationEvidence: response.raw } : {})
  };
}

function retainUncertain(record, classification, response, { verifierName, attempts } = {}) {
  return {
    ...record,
    coverageStatus: record.status,
    status: "uncertain-llm",
    verificationStatus: "uncertain-llm",
    certainty: "llm",
    certaintyScore: classification.certaintyScore,
    deterministicChecks: classification.deterministicChecks,
    verificationAttempts: attempts,
    verifier: verifierName,
    verificationRationale: response?.rationale ?? response?.reason ?? "bounded verification did not establish a decision",
    ...(response?.headKind ? { verificationHeadKind: response.headKind } : {}),
    ...(response?.raw ? { verificationEvidence: response.raw } : {})
  };
}

function retainRejected(record, classification, response, { verifierName, attempts } = {}) {
  return {
    ...record,
    coverageStatus: record.status,
    status: "rejected-llm",
    verificationStatus: "rejected-llm",
    certainty: "llm",
    certaintyScore: classification.certaintyScore,
    deterministicChecks: classification.deterministicChecks,
    verificationAttempts: attempts,
    verifier: verifierName,
    verificationRationale: response?.rationale ?? response?.reason ?? "candidate rejected by bounded verification",
    ...(response?.headKind ? { verificationHeadKind: response.headKind } : {}),
    ...(response?.raw ? { verificationEvidence: response.raw } : {})
  };
}

function candidateGroupKey(record) {
  return `${normalizeText(record?.target)}\u0000${JSON.stringify(record?.sourceSurfaces ?? {})}`;
}

export async function verifyCompoundCoverage(records, {
  invoke,
  verifierName = "compound verifier",
  maxRepairAttempts = 1,
  onRecord
} = {}) {
  const classification = classifyCompoundCoverage(records);
  if (classification.verificationCandidates.length > 0 && typeof invoke !== "function") {
    throw invalid("compound verification requires an invoke function for uncertain records");
  }
  const repairLimit = Math.min(1, Math.max(0, Number.isFinite(Number(maxRepairAttempts))
    ? Math.trunc(Number(maxRepairAttempts))
    : 1));
  const verified = [];
  const handledGroups = new Set();
  const emit = async (record) => {
    verified.push(record);
    if (typeof onRecord === "function") {
      await onRecord({ record, records: [...verified], total: classification.records.length });
    }
  };
  for (const record of classification.records) {
    if (record.certainty !== "llm") {
      await emit(record);
      continue;
    }
    const groupKey = candidateGroupKey(record);
    if (handledGroups.has(groupKey)) continue;
    handledGroups.add(groupKey);
    const candidates = classification.verificationCandidates.filter((candidate) => candidateGroupKey(candidate) === groupKey);
    const prompt = buildCompoundVerificationPrompt({ record, candidates });
    let attempts = 1;
    let raw = await invoke({ phase: "verify", prompt, record, candidates, attempt: attempts });
    let response = parseCompoundVerificationResponse(raw, { candidates });
    let repaired = false;
    while (!response.valid && repaired === false && repairLimit > 0) {
      repaired = true;
      attempts += 1;
      const repairPrompt = [
        prompt,
        "\nThe previous response failed this deterministic contract:",
        response.reason,
        "Return only one corrected JSON object with verdict, candidateId when accepting, and rationale.",
        "PREVIOUS RESPONSE:",
        String(raw ?? "")
      ].join("\n");
      raw = await invoke({ phase: "repair", prompt: repairPrompt, record, candidates, attempt: attempts, previous: response });
      response = parseCompoundVerificationResponse(raw, { candidates });
    }
    if (!response.valid) {
      for (const candidate of candidates) {
        await emit(retainUncertain(candidate, { ...candidate, ...classifyCompoundCertainty(candidate) }, {
          reason: response.reason,
          raw: String(raw ?? "")
        }, { verifierName, attempts }));
      }
      continue;
    }
    for (const candidate of candidates) {
      const candidateClassification = { ...candidate, ...classifyCompoundCertainty(candidate) };
      if (response.verdict === "accept" && response.candidateId === candidateId(candidate)) {
        if (response.headKind === "lexical-head") {
          await emit(applyVerification(candidate, candidateClassification, response, {
            verifierName,
            attempts,
            repaired
          }));
        } else {
          await emit(retainRejected(candidate, candidateClassification, {
            ...response,
            rationale: `final component classified as ${response.headKind}: ${response.rationale}`
          }, { verifierName, attempts }));
        }
      } else if (response.verdict === "accept") {
        await emit(retainRejected(candidate, candidateClassification, {
          ...response,
          rationale: `alternative candidate not selected: ${response.rationale}`
        }, { verifierName, attempts }));
      } else if (response.verdict === "reject") {
        await emit(retainRejected(candidate, candidateClassification, response, { verifierName, attempts }));
      } else {
        await emit(retainUncertain(candidate, candidateClassification, response, { verifierName, attempts }));
      }
    }
  }
  return {
    records: verified,
    deterministic: verified.filter((record) => record.verificationStatus === "accepted-deterministic"),
    accepted: verified.filter((record) => ["accepted-deterministic", "accepted-llm", "repaired-llm"].includes(record.verificationStatus)),
    uncertain: verified.filter((record) => record.verificationStatus === "uncertain-llm"),
    rejected: verified.filter((record) => ["rejected-deterministic", "rejected-llm"].includes(record.verificationStatus))
  };
}

export function createMindCompoundVerifier({
  interpret,
  readText,
  mindName = "compound verifier",
  outputName = "compound verifier output",
  maxTokens = 320
} = {}) {
  if (typeof interpret !== "function") throw invalid("compound mind verifier requires interpret");
  if (typeof readText !== "function") throw invalid("compound mind verifier requires readText");
  return async ({ prompt }) => {
    await interpret({
      mood: "do",
      be: "write",
      for: { name: mindName },
      ob: { text: prompt },
      to: { name: outputName, nameTypeWords: ["text"] },
      by: { num: 0 },
      atmost: { num: maxTokens }
    });
    return readText(outputName);
  };
}

export async function createDefaultMindCompoundVerifier(options = {}) {
  const [{ interpret }, { remember }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../remember/index.mjs")
  ]);
  return createMindCompoundVerifier({
    interpret,
    readText: (name) => remember(name)?.ob?.text ?? "",
    ...options
  });
}
