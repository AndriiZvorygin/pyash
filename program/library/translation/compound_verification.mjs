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
const COMPOUND_VERIFICATION_MAX_OUTPUT_TOKENS = 288;
const COMPOUND_VERIFIER_QUEUE_FORMAT = "compound-verifier-v10";
const MODIFIER_RELATIONS = new Set(["literal", "metaphorical", "associative", "uncertain"]);
const NON_LITERAL_EVIDENCE = /\b(?:metaphor(?:ical(?:ly)?)?|figurative(?:ly)?|symbolic(?:ally)?|associative(?:ly)?|wordplay|pun|merely associated|only associated)\b/iu;

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
    headRelationPolicy: normalizeText(value.headRelationPolicy) || "required",
    modifiers: value.modifiers ?? [],
    componentRoles: value.componentRoles ?? [],
    morphologyStatus: value.morphologyStatus ?? "",
    morphologySignals: value.morphologySignals ?? [],
    componentLayers: value.componentLayers ?? [],
    componentSenseEvidence: (Array.isArray(value.componentSenseEvidence) ? value.componentSenseEvidence : [])
      .slice(0, 12)
      .map((sense) => ({
        component: normalizeText(sense?.component),
        source: normalizeText(sense?.source),
        lemmas: Array.isArray(sense?.lemmas) ? sense.lemmas.slice(0, 8) : [],
        definition: normalizeText(sense?.definition).split(";")[0].slice(0, 320)
      })),
    targetSenseEvidence: (Array.isArray(value.targetSenseEvidence) ? value.targetSenseEvidence : [])
      .slice(0, 4)
      .map((sense) => ({
        source: normalizeText(sense?.source),
        pos: normalizeText(sense?.pos),
        lemmas: Array.isArray(sense?.lemmas) ? sense.lemmas.slice(0, 8) : [],
        definition: normalizeText(sense?.definition).split(";")[0].slice(0, 320),
        ...(sense?.headRelationPolicy ? { headRelationPolicy: normalizeText(sense.headRelationPolicy) } : {}),
        compatibleHeadSenseIds: Array.isArray(sense?.compatibleHeadSenseIds)
          ? sense.compatibleHeadSenseIds.slice(0, 12)
          : []
      })),
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
    "Use the supplied target WordNet sense definitions to judge whether the components compose the target meaning.",
    "Use the supplied WordNet definitions for each component to choose its relevant meaning; do not infer a component sense from spelling alone.",
    "Pyash order is head-final: the final component is the semantic head.",
    "Use WordNet head relations as supporting evidence. Enforce compatibleHeadSenseIds when headRelationPolicy is required (the default). When the policy is advisory, part-of-speech labels and missing hypernym edges do not veto a compound; judge the target and component definitions directly.",
    "When headRelationPolicy is required, the target sense must be literally a kind of the final component; when it is advisory, judge literal composition from the supplied definitions without requiring that relation.",
    "For every modifier before the final head, cite one supplied component sense in componentGlosses order, state its contribution, and classify that contribution as literal, metaphorical, associative, or uncertain.",
    "Accept only when every modifier contributes its defined meaning literally to the target. If any modifier depends on metaphor, figurative meaning, symbolism, wordplay, or association, reject or mark uncertain.",
    "The final component is the proposed semantic head. For advisory head relations, judge whether the target definition composes literally with that head and the modifiers; do not require the target to share the head's part of speech.",
    "A spelling match, association, metaphor, idiom, derivational ending, grammatical ending, or unrelated homograph is not a lexical head.",
    "For named groups or proper-name senses, accept only if the supplied target definition establishes the same literal component composition.",
    "Component glosses and source-language spellings suggest a segmentation; they do not prove it. If no supplied target sense supports the composition, reject or mark uncertain.",
    "For an accepted candidate, cite one supplied target sense id, one supplied final-component sense id, and one supplied sense id plus a relation label for each modifier. Never invent ids.",
    "Return one compact JSON object with exactly these fields:",
    '{"verdict":"accept|reject|uncertain","candidateId":"...","headKind":"lexical-head|derivational-ending|grammatical-ending|uncertain","targetSenseId":"...|empty","headSenseId":"...|empty","modifierSenseIds":["..."],"modifierEvidence":["..."],"modifierRelations":["literal|metaphorical|associative|uncertain"],"rationale":"..."}',
    "An accept must use a supplied candidateId, preserve its component sequence, set headKind to lexical-head, cite supplied targetSenseId and headSenseId values, and give one modifierSenseId, one nonempty modifierEvidence explanation, and one modifierRelations label per modifier. Every accepted modifierRelations value must be literal. Keep rationale under 120 characters.",
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
  const citedSense = normalizeText(payload.targetSenseId ?? payload.target_sense_id
    ?? payload.senseId ?? payload.sense_id ?? payload.supportingSenseId ?? payload.supporting_sense_id);
  const rationaleSenseIds = [...new Set(rationale.match(/\b[nvars]:\d{8}-[nvars]\b/gu) ?? [])];
  const supportingSenseId = citedSense || (rationaleSenseIds.length === 1 ? rationaleSenseIds[0] : "");
  const selectedCandidate = candidateMap.get(selectedId);
  const head = normalizeText(selectedCandidate?.componentGlosses?.at(-1) ?? selectedCandidate?.head);
  const headSenseIds = new Set((selectedCandidate?.componentSenseEvidence ?? [])
    .filter((sense) => normalizeText(sense?.component) === head)
    .map((sense) => normalizeText(sense?.source)));
  const citedHeadSenseId = normalizeText(payload.headSenseId ?? payload.head_sense_id);
  const rationaleHeadSenseIds = rationaleSenseIds.filter((id) => headSenseIds.has(id));
  const supportingHeadSenseId = citedHeadSenseId || (rationaleHeadSenseIds.length === 1 ? rationaleHeadSenseIds[0] : "");
  const supportingModifierSenseIds = Array.isArray(payload.modifierSenseIds)
    ? payload.modifierSenseIds.map(normalizeText)
    : [];
  const supportingModifierEvidence = Array.isArray(payload.modifierEvidence)
    ? payload.modifierEvidence.map(normalizeText)
    : [];
  const supportingModifierRelations = Array.isArray(payload.modifierRelations)
    ? payload.modifierRelations.map((relation) => normalizeText(relation).toLowerCase())
    : [];
  if (verdict === "accept" && Array.isArray(selectedCandidate?.targetSenseEvidence)
    && selectedCandidate.targetSenseEvidence.length > 0) {
    const targetSenseIds = new Set(selectedCandidate.targetSenseEvidence.map((sense) => normalizeText(sense?.source)));
    if (!supportingSenseId || !targetSenseIds.has(supportingSenseId)) {
      return { valid: false, reason: "accepted response must cite a supplied target sense source id" };
    }
  }
  if (verdict === "accept" && headSenseIds.size > 0 && !headSenseIds.has(supportingHeadSenseId)) {
    return { valid: false, reason: "accepted response must cite a supplied sense for the final component" };
  }
  const componentGlosses = selectedCandidate?.componentGlosses
    ?? selectedCandidate?.sourceMorphemes
    ?? selectedCandidate?.morphemes
    ?? [];
  const modifierComponents = Array.isArray(componentGlosses)
    ? componentGlosses.slice(0, -1).map(normalizeText)
    : [];
  if (verdict === "accept") {
    if (supportingModifierSenseIds.length !== modifierComponents.length
      || supportingModifierEvidence.length !== modifierComponents.length
      || supportingModifierRelations.length !== modifierComponents.length) {
      return {
        valid: false,
        reason: "accepted response must cite a supplied WordNet sense, explain each modifier, and classify its contribution in component order"
      };
    }
    for (const [index, component] of modifierComponents.entries()) {
      const senseId = supportingModifierSenseIds[index];
      const senseExists = (selectedCandidate?.componentSenseEvidence ?? []).some((sense) => (
        normalizeText(sense?.component) === component && normalizeText(sense?.source) === senseId
      ));
      if (!senseId || !senseExists || !supportingModifierEvidence[index]) {
        return {
          valid: false,
          reason: `accepted response must cite a supplied WordNet sense and evidence for modifier ${JSON.stringify(component)}`
        };
      }
      if (!MODIFIER_RELATIONS.has(supportingModifierRelations[index])) {
        return {
          valid: false,
          reason: `accepted response must classify modifier ${JSON.stringify(component)} as literal, metaphorical, associative, or uncertain`
        };
      }
    }
  }
  const selectedTargetSense = selectedCandidate?.targetSenseEvidence?.find((sense) => (
    normalizeText(sense?.source) === supportingSenseId
  ));
  const headRelationPolicy = normalizeText(
    selectedCandidate?.headRelationPolicy ?? selectedTargetSense?.headRelationPolicy
  ).toLowerCase() || "required";
  const hasWordNetCompatibility = Array.isArray(selectedTargetSense?.compatibleHeadSenseIds);
  const headRelationSupported = hasWordNetCompatibility
    ? selectedTargetSense.compatibleHeadSenseIds.includes(supportingHeadSenseId)
    : undefined;
  const nonLiteralModifier = supportingModifierRelations.some((relation) => relation !== "literal")
    || NON_LITERAL_EVIDENCE.test(`${supportingModifierEvidence.join(" ")} ${rationale}`);
  if (verdict === "accept" && nonLiteralModifier) {
    return {
      valid: true,
      verdict: "uncertain",
      candidate: selectedCandidate,
      candidateId: selectedId,
      headKind: "uncertain",
      supportingSenseId,
      supportingHeadSenseId,
      supportingModifierSenseIds,
      supportingModifierEvidence,
      supportingModifierRelations,
      ...(headRelationSupported !== undefined ? { headRelationSupported } : {}),
      rationale: `model acceptance withheld: modifier contribution is non-literal or explicitly figurative; ${rationale}`.slice(0, MAX_RATIONALE_CHARS),
      raw: String(text ?? "")
    };
  }
  if (verdict === "accept" && headRelationSupported === false && headRelationPolicy !== "advisory") {
    return {
      valid: true,
      verdict: "uncertain",
      candidate: selectedCandidate,
      candidateId: selectedId,
      headKind: "uncertain",
      supportingSenseId,
      supportingHeadSenseId,
      supportingModifierSenseIds,
      supportingModifierEvidence,
      supportingModifierRelations,
      headRelationSupported: false,
      rationale: `model acceptance withheld: no WordNet head relation supports this target/head pair; ${rationale}`.slice(0, MAX_RATIONALE_CHARS),
      raw: String(text ?? "")
    };
  }
  return {
    valid: true,
    verdict,
    candidate: selectedId ? candidateMap.get(selectedId) : null,
    candidateId: selectedId,
    headKind: headKind || "uncertain",
    supportingSenseId,
    supportingHeadSenseId,
    ...(supportingModifierSenseIds.length > 0 ? { supportingModifierSenseIds } : {}),
    ...(supportingModifierEvidence.length > 0 ? { supportingModifierEvidence } : {}),
    ...(supportingModifierRelations.length > 0 ? { supportingModifierRelations } : {}),
    ...(headRelationSupported !== undefined ? { headRelationSupported } : {}),
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
    ...(response.supportingSenseId ? { verificationSenseId: response.supportingSenseId } : {}),
    ...(response.supportingHeadSenseId ? { verificationHeadSenseId: response.supportingHeadSenseId } : {}),
    ...(Array.isArray(response.supportingModifierSenseIds)
      ? { verificationModifierSenseIds: response.supportingModifierSenseIds }
      : {}),
    ...(Array.isArray(response.supportingModifierEvidence)
      ? { verificationModifierEvidence: response.supportingModifierEvidence }
      : {}),
    ...(Array.isArray(response.supportingModifierRelations)
      ? { verificationModifierRelations: response.supportingModifierRelations }
      : {}),
    ...(response.headRelationSupported !== undefined
      ? { verificationHeadRelation: response.headRelationSupported ? "supported" : "unsupported" }
      : {}),
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
    ...(response?.supportingSenseId ? { verificationSenseId: response.supportingSenseId } : {}),
    ...(response?.supportingHeadSenseId ? { verificationHeadSenseId: response.supportingHeadSenseId } : {}),
    ...(Array.isArray(response?.supportingModifierSenseIds)
      ? { verificationModifierSenseIds: response.supportingModifierSenseIds }
      : {}),
    ...(Array.isArray(response?.supportingModifierEvidence)
      ? { verificationModifierEvidence: response.supportingModifierEvidence }
      : {}),
    ...(Array.isArray(response?.supportingModifierRelations)
      ? { verificationModifierRelations: response.supportingModifierRelations }
      : {}),
    ...(response?.headRelationSupported !== undefined
      ? { verificationHeadRelation: response.headRelationSupported ? "supported" : "unsupported" }
      : {}),
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
    ...(response?.supportingSenseId ? { verificationSenseId: response.supportingSenseId } : {}),
    ...(response?.supportingHeadSenseId ? { verificationHeadSenseId: response.supportingHeadSenseId } : {}),
    ...(Array.isArray(response?.supportingModifierSenseIds)
      ? { verificationModifierSenseIds: response.supportingModifierSenseIds }
      : {}),
    ...(Array.isArray(response?.supportingModifierEvidence)
      ? { verificationModifierEvidence: response.supportingModifierEvidence }
      : {}),
    ...(Array.isArray(response?.supportingModifierRelations)
      ? { verificationModifierRelations: response.supportingModifierRelations }
      : {}),
    ...(response?.headRelationSupported !== undefined
      ? { verificationHeadRelation: response.headRelationSupported ? "supported" : "unsupported" }
      : {}),
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
  parallelism = 1,
  onRecord
} = {}) {
  const classification = classifyCompoundCoverage(records);
  if (classification.verificationCandidates.length > 0 && typeof invoke !== "function") {
    throw invalid("compound verification requires an invoke function for uncertain records");
  }
  const repairLimit = Math.min(1, Math.max(0, Number.isFinite(Number(maxRepairAttempts))
    ? Math.trunc(Number(maxRepairAttempts))
    : 1));
  const width = Math.max(1, Math.trunc(Number(parallelism) || 1));
  const units = [];
  const llmGroups = new Map();
  for (const [index, record] of classification.records.entries()) {
    if (record.certainty !== "llm") {
      units.push({ index, record, candidates: [record], deterministic: true });
      continue;
    }
    const groupKey = candidateGroupKey(record);
    let group = llmGroups.get(groupKey);
    if (!group) {
      group = { index, record, candidates: [], deterministic: false };
      llmGroups.set(groupKey, group);
    }
    group.candidates.push(record);
  }
  units.push(...llmGroups.values());
  units.sort((left, right) => left.index - right.index);

  const verifiedById = new Map();
  const emit = async (record) => {
    verifiedById.set(candidateId(record), record);
    if (typeof onRecord !== "function") return;
    const snapshot = classification.records
      .map((candidate) => verifiedById.get(candidateId(candidate)))
      .filter(Boolean);
    await onRecord({ record, records: snapshot, total: classification.records.length });
  };
  const verifyUnit = async (unit) => {
    if (unit.deterministic) return unit.candidates;
    const { record, candidates } = unit;
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
        "Return only one corrected JSON object with verdict, candidateId, headKind, targetSenseId, headSenseId, modifierSenseIds, modifierEvidence, modifierRelations, and rationale.",
        "PREVIOUS RESPONSE:",
        String(raw ?? "")
      ].join("\n");
      raw = await invoke({ phase: "repair", prompt: repairPrompt, record, candidates, attempt: attempts, previous: response });
      response = parseCompoundVerificationResponse(raw, { candidates });
    }
    if (!response.valid) {
      return candidates.map((candidate) => retainUncertain(candidate, { ...candidate, ...classifyCompoundCertainty(candidate) }, {
          reason: response.reason,
          raw: String(raw ?? "")
        }, { verifierName, attempts }));
    }
    const results = [];
    for (const candidate of candidates) {
      const candidateClassification = { ...candidate, ...classifyCompoundCertainty(candidate) };
      if (response.verdict === "accept" && response.candidateId === candidateId(candidate)) {
        if (response.headKind === "lexical-head") {
          results.push(applyVerification(candidate, candidateClassification, response, {
            verifierName,
            attempts,
            repaired
          }));
        } else {
          results.push(retainRejected(candidate, candidateClassification, {
            ...response,
            rationale: `final component classified as ${response.headKind}: ${response.rationale}`
          }, { verifierName, attempts }));
        }
      } else if (response.verdict === "accept") {
        results.push(retainRejected(candidate, candidateClassification, {
          ...response,
          rationale: `alternative candidate not selected: ${response.rationale}`
        }, { verifierName, attempts }));
      } else if (response.verdict === "reject") {
        results.push(retainRejected(candidate, candidateClassification, response, { verifierName, attempts }));
      } else {
        results.push(retainUncertain(candidate, candidateClassification, response, { verifierName, attempts }));
      }
    }
    return results;
  };
  for (let offset = 0; offset < units.length; offset += width) {
    const batch = units.slice(offset, offset + width);
    const settled = await Promise.allSettled(batch.map(verifyUnit));
    let batchError = null;
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "rejected") {
        batchError ??= outcome.reason;
        continue;
      }
      for (const record of outcome.value) await emit(record);
    }
    if (batchError) throw batchError;
  }
  const verified = classification.records
    .map((record) => verifiedById.get(candidateId(record)))
    .filter(Boolean);
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

function queuedCompoundHandle({ record, phase = "verify", attempt = 1 } = {}) {
  const candidate = candidateId(record).replace(/[^a-z0-9._-]+/giu, "-");
  return `${COMPOUND_VERIFIER_QUEUE_FORMAT}-${candidate}-${phase}-${Math.max(1, Math.trunc(Number(attempt) || 1))}`;
}

export function createQueuedMindCompoundVerifier({
  interpret,
  parse,
  timeoutMs = 1800000,
  maxOutputTokens = COMPOUND_VERIFICATION_MAX_OUTPUT_TOKENS
} = {}) {
  if (typeof interpret !== "function") throw invalid("queued compound verifier requires interpret");
  if (typeof parse !== "function") throw invalid("queued compound verifier requires parse");
  const waitMs = Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000));
  return async ({ prompt, record, candidates = [], phase = "verify", attempt = 1 } = {}) => {
    const handleId = queuedCompoundHandle({ record, phase, attempt });
    const candidateIds = [...new Set((Array.isArray(candidates) && candidates.length > 0 ? candidates : [record])
      .map(candidateId)
      .filter(Boolean))];
    const senseIds = [...new Set((Array.isArray(candidates) && candidates.length > 0 ? candidates : [record])
      .flatMap((candidate) => Array.isArray(candidate?.targetSenseEvidence)
        ? candidate.targetSenseEvidence.map((sense) => normalizeText(sense?.source))
        : [])
      .filter(Boolean))];
    const headSenseIds = [...new Set((Array.isArray(candidates) && candidates.length > 0 ? candidates : [record])
      .flatMap((candidate) => Array.isArray(candidate?.componentSenseEvidence)
        ? candidate.componentSenseEvidence
          .filter((sense) => normalizeText(sense?.component) === normalizeText(candidate?.componentGlosses?.at(-1) ?? candidate?.head))
          .map((sense) => normalizeText(sense?.source))
        : [])
      .filter(Boolean))];
    const modifierSenseIds = [...new Set((Array.isArray(candidates) && candidates.length > 0 ? candidates : [record])
      .flatMap((candidate) => {
        const components = Array.isArray(candidate?.componentGlosses)
          ? candidate.componentGlosses
          : Array.isArray(candidate?.sourceMorphemes)
            ? candidate.sourceMorphemes
            : Array.isArray(candidate?.morphemes) ? candidate.morphemes : [];
        const modifiers = new Set(components.slice(0, -1).map(normalizeText));
        return Array.isArray(candidate?.componentSenseEvidence)
          ? candidate.componentSenseEvidence
            .filter((sense) => modifiers.has(normalizeText(sense?.component)))
            .map((sense) => normalizeText(sense?.source))
          : [];
      })
      .filter(Boolean))];
    const jobSpec = {
      kind: "ollama-generate",
      prompt: String(prompt ?? ""),
      stream: false,
      think: false,
      format: {
        type: "object",
        required: ["verdict", "candidateId", "headKind", "targetSenseId", "headSenseId", "modifierSenseIds", "modifierEvidence", "modifierRelations", "rationale"],
        additionalProperties: false,
        properties: {
          verdict: { type: "string", enum: ["accept", "reject", "uncertain"] },
          candidateId: { type: "string", enum: ["", ...candidateIds] },
          headKind: { type: "string", enum: [...RESPONSE_HEAD_KINDS] },
          targetSenseId: { type: "string", enum: ["", ...senseIds] },
          headSenseId: { type: "string", enum: ["", ...headSenseIds] },
          modifierSenseIds: {
            type: "array",
            minItems: 0,
            maxItems: 2,
            items: { type: "string", enum: ["", ...modifierSenseIds] }
          },
          modifierEvidence: {
            type: "array",
            minItems: 0,
            maxItems: 2,
            items: { type: "string", maxLength: 120 }
          },
          modifierRelations: {
            type: "array",
            minItems: 0,
            maxItems: 2,
            items: { type: "string", enum: [...MODIFIER_RELATIONS] }
          },
          rationale: { type: "string", maxLength: 160 }
        }
      },
      options: {
        temperature: 0,
        num_predict: Math.max(32, Math.trunc(Number(maxOutputTokens) || COMPOUND_VERIFICATION_MAX_OUTPUT_TOKENS))
      }
    };
    const start = await interpret(parse(
      `su name ${JSON.stringify(handleId)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    if (String(start?.ob?.text ?? "").trim() !== "queued") {
      throw invalid("queued compound verifier did not receive a queued duty", { handleId, start });
    }
    const completed = await interpret(parse(
      `accordingto text ${JSON.stringify(handleId)} during num ${waitMs} vyah await be gpu do`
    ));
    if (String(completed?.ob?.text ?? "").trim() !== "success") {
      throw invalid("queued compound verifier duty did not complete successfully", { handleId, completed });
    }
    return String(completed?.result?.text ?? "");
  };
}

export async function createDefaultMindCompoundVerifier(options = {}) {
  const [{ interpret }, { remember }] = await Promise.all([
    import("../../bridge/index.mjs"),
    import("../../remember/index.mjs")
  ]);
  return createMindCompoundVerifier({
    interpret,
    readText: (name) => remember(name)?.ob?.text ?? "",
    ...options
  });
}

export async function createDefaultQueuedMindCompoundVerifier(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../bridge/index.mjs"),
    import("../../understand/index.mjs")
  ]);
  return createQueuedMindCompoundVerifier({
    interpret,
    parse,
    ...options
  });
}
