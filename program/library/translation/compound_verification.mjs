const DETERMINISTIC_STATUSES = new Set(["accepted-delimited", "accepted-curated"]);
const UNCERTAIN_STATUSES = new Set(["candidate-closed"]);

export const COMPOUND_VERIFICATION_STATUSES = Object.freeze([
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm",
  "not-selected-llm",
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
const MAX_QUEUED_MIND_ENVELOPE_CHARS = 256000;
const COMPOUND_VERIFICATION_MAX_OUTPUT_TOKENS = 192;
const COMPOUND_VERIFIER_QUEUE_FORMAT = "compound-verifier-v12-synset-groups";
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
  return [
    payload.response,
    payload.output_text,
    payload.output,
    payload.text,
    payload.message?.content,
    choice?.message?.content,
    choice?.text
  ].find((answer) => typeof answer === "string") ?? raw;
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

function targetPosFor(record) {
  return normalizeText(record?.targetPartOfSpeech)
    || normalizeText(record?.targetSenseEvidence?.[0]?.pos);
}

function matchingPosRank(sense, targetPos) {
  if (!targetPos) return 1;
  const sensePos = normalizeText(sense?.pos || normalizeText(sense?.source).slice(0, 1));
  if (targetPos === "a" || targetPos === "s") return ["a", "s"].includes(sensePos) ? 0 : 1;
  return sensePos === targetPos ? 0 : 1;
}

function candidateComponents(record) {
  return Array.isArray(record?.componentGlosses)
    ? record.componentGlosses.map(normalizeText)
    : Array.isArray(record?.sourceMorphemes)
      ? record.sourceMorphemes.map(normalizeText)
      : Array.isArray(record?.morphemes) ? record.morphemes.map(normalizeText) : [];
}

function promptComponentEvidence(record) {
  const senses = Array.isArray(record?.componentSenseEvidence) ? record.componentSenseEvidence : [];
  const components = candidateComponents(record);
  const targetPos = targetPosFor(record);
  return components.map((component) => {
    const componentSenses = senses
      .map((sense, index) => ({ sense, index }))
      .filter(({ sense }) => normalizeText(sense?.component) === component)
      .sort((left, right) => matchingPosRank(left.sense, targetPos)
        - matchingPosRank(right.sense, targetPos)
        || Number(normalizeText(left.sense?.mappingKind) === "word-suggestion")
          - Number(normalizeText(right.sense?.mappingKind) === "word-suggestion")
        || left.index - right.index)
      .slice(0, 2);
    const linkedSenses = componentSenses.map(({ sense }) => ({
      id: normalizeText(sense?.source),
      pos: normalizeText(sense?.pos || normalizeText(sense?.source).slice(0, 1)),
      definition: normalizeText(sense?.definition).split(";")[0].slice(0, 220),
      ...(normalizeText(sense?.mappingKind) ? { mappingKind: normalizeText(sense.mappingKind) } : {}),
      ...(normalizeText(sense?.mappingKind) === "word-suggestion"
        ? { mappingLookupGloss: normalizeText(sense?.mappingLookupGloss) }
        : {})
    }));
    const sourceGlossEvidence = [];
    for (const { sense } of componentSenses) {
      const linkedSenseId = normalizeText(sense?.source);
      const gloss = normalizeText(sense?.mappingLookupGloss);
      const sourceSenses = Array.isArray(sense?.mappingLookupSenseEvidence) ? sense.mappingLookupSenseEvidence : [];
      if (!linkedSenseId || !gloss || sourceSenses.length === 0) continue;
      sourceGlossEvidence.push({
        linkedSenseId,
        gloss,
        senses: sourceSenses.slice(0, 1).map((sourceSense) => ({
          id: normalizeText(sourceSense?.source),
          pos: normalizeText(sourceSense?.pos),
          definition: normalizeText(sourceSense?.definition).split(";")[0].slice(0, 180)
        }))
      });
    }
    return { component, linkedSenses, sourceGlossEvidence };
  });
}

function promptSourceLanguages(value) {
  const languages = [...new Set(value?.sourceLanguages ?? Object.keys(value?.sourceSurfaces ?? {}))]
    .map(normalizeText)
    .filter(Boolean)
    .sort();
  return languages.map((language) => {
    const sourceParts = value?.sourceTranslationMorphemesByLanguage?.[language] ?? [];
    const sourceGlosses = value?.sourceTranslationGlossesByLanguage?.[language] ?? [];
    const sourceRoles = value?.sourceComponentRolesByLanguage?.[language] ?? [];
    const componentGlosses = value?.sourceComponentGlossesByLanguage?.[language] ?? [];
    const componentIndexes = value?.sourceComponentIndexesByLanguage?.[language]
      ?? sourceParts.map((_, index) => index);
    return {
      language,
      surface: normalizeText(value?.sourceSurfaces?.[language]),
      compositionEvidence: normalizeText(value?.sourceCompositionEvidenceByLanguage?.[language]).slice(0, 180),
      components: componentIndexes.map((sourceIndex, componentIndex) => ({
        pyashComponent: normalizeText(value?.componentGlosses?.[componentIndex]),
        sourceIndex,
        surface: normalizeText(sourceParts[sourceIndex]),
        gloss: normalizeText(sourceGlosses[sourceIndex] ?? componentGlosses[componentIndex]),
        role: normalizeText(sourceRoles[sourceIndex])
      }))
    };
  });
}

export function buildCompoundVerificationPrompt({ record, candidates = [record] } = {}) {
  if (!record || typeof record !== "object") throw invalid("compound verification prompt requires a record");
  const validCandidates = candidates.filter((candidate) => candidate && typeof candidate === "object");
  if (validCandidates.length > 8) {
    throw invalid("compound verification group exceeds the eight-candidate prompt limit", {
      candidateCount: validCandidates.length
    });
  }
  const targetSense = (record.targetSenseEvidence ?? []).find((sense) => (
    normalizeText(sense?.source) === normalizeText(record.senseId)
  )) ?? record.targetSenseEvidence?.[0];
  const sourceDecompositions = new Map();
  const linkedEvidenceByKey = new Map();
  const candidateRows = validCandidates.map((candidate) => {
    const languageRows = promptSourceLanguages(candidate).filter((row) => (
      row.surface || row.components.length > 0
    ));
    const sourceComponentIndexes = {};
    for (const languageRow of languageRows) {
      const sourceParts = candidate.sourceTranslationMorphemesByLanguage?.[languageRow.language] ?? [];
      const sourceGlosses = candidate.sourceTranslationGlossesByLanguage?.[languageRow.language] ?? [];
      const decomposition = {
        language: languageRow.language,
        surface: languageRow.surface,
        parts: sourceParts.map((surface, index) => ({
          surface: normalizeText(surface),
          gloss: normalizeText(sourceGlosses[index] ?? ""),
          role: normalizeText(candidate.sourceComponentRolesByLanguage?.[languageRow.language]?.[index])
        })),
        compositionEvidence: languageRow.compositionEvidence.slice(0, 120)
      };
      sourceDecompositions.set(JSON.stringify(decomposition), decomposition);
      sourceComponentIndexes[languageRow.language] = languageRow.components.map((component) => component.sourceIndex);
    }
    const componentEvidence = promptComponentEvidence(candidate);
    return JSON.stringify({
      id: candidateId(candidate),
      pyashComponents: candidateComponents(candidate).map((word, index) => ({
        word,
        pyac: normalizeText(candidate?.pyashSequence?.[index]),
        senseEvidenceIds: (componentEvidence[index]?.linkedSenses ?? []).map((sense) => {
          const sourceGloss = componentEvidence[index]?.sourceGlossEvidence
            .find((source) => source.linkedSenseId === sense.id);
          const linkedEvidence = {
            id: sense.id,
            pos: sense.pos,
            definition: sense.definition.slice(0, 180),
            ...(sense.mappingKind ? { mappingKind: sense.mappingKind } : {}),
            ...(sense.mappingLookupGloss ? { mappingLookupGloss: sense.mappingLookupGloss } : {}),
            ...(sourceGloss ? {
              sourceGlossEvidence: {
                gloss: sourceGloss.gloss,
                senses: sourceGloss.senses.slice(0, 1).map((sourceSense) => ({
                  id: sourceSense.id,
                  pos: sourceSense.pos,
                  definition: sourceSense.definition.slice(0, 120)
                }))
              }
            } : {})
          };
          const key = JSON.stringify(linkedEvidence);
          let stored = linkedEvidenceByKey.get(key);
          if (!stored) {
            stored = { evidenceId: `e${linkedEvidenceByKey.size + 1}`, ...linkedEvidence };
            linkedEvidenceByKey.set(key, stored);
          }
          return stored.evidenceId;
        })
      })),
      sourceComponentIndexes
    });
  }).join("\n");
  const prompt = [
    "Choose at most one literal Pyash compound for this WordNet sense.",
    "Every listed candidate targets the same synset. Compare the full list; select at most one.",
    "Use the supplied target and WordNet definitions for each component, plus translated parts; spelling alone is insufficient.",
    "A grammatical, bound, or uncertain source part cannot support acceptance. Part-of-speech labels help choose senses but do not decide whether a compound is eligible; head relations are optional.",
    "Accept only if current component meanings compose the target. Reject only when every listed candidate clearly mismatches; otherwise use uncertain.",
    "For accept, cite target/component IDs in order. For word-suggestions, compare source-gloss meaning and polarity and cite its ID; otherwise use an empty string.",
    "For reject, candidateId and targetSenseId are empty. Keep rationale under 120 characters.",
    '{"verdict":"accept|reject|uncertain","candidateId":"accepted id or empty","headKind":"lexical-head|derivational-ending|grammatical-ending|uncertain","targetSenseId":"...|empty","componentSenseIds":["one id per component"],"sourceGlossSenseIds":["one id per component or empty"],"composition":"literal|nonliteral|uncertain","rationale":"brief reason"}',
    `TARGET: ${JSON.stringify({
      id: normalizeText(targetSense?.source ?? record.senseId),
      pos: normalizeText(targetSense?.pos ?? record.targetPartOfSpeech),
      definition: normalizeText(targetSense?.definition).split(";")[0].slice(0, 180)
    })}`,
    `SOURCE LANGUAGE DECOMPOSITIONS: ${JSON.stringify([...sourceDecompositions.values()])}`,
    `LINKED ATOM SENSE EVIDENCE (candidate evidence ids refer here): ${JSON.stringify([...linkedEvidenceByKey.values()])}`,
    "CANDIDATES (sourceComponentIndexes maps each component to its translated part):",
    candidateRows
  ].join("\n");
  if (prompt.length > 10000) {
    throw invalid("compound verification prompt exceeds the safe character budget", {
      characters: prompt.length,
      candidateCount: validCandidates.length
    });
  }
  return prompt;
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

function polarityRoots(value, { negativeOnly = false } = {}) {
  const tokens = normalizeText(value).toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
  const stopWords = new Set(["a", "an", "and", "are", "as", "be", "been", "being", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "was", "were", "with"]);
  const roots = new Set();
  for (const raw of tokens) {
    const token = raw.replace(/^-+|-+$/gu, "");
    if (!token || stopWords.has(token)) continue;
    if (/^(?:not|never|without|lack|lacks|lacked|lacking|absence)$/u.test(token)) continue;
    const explicit = /^(?:un|non|dis)-?/u.exec(token);
    const root = explicit ? token.slice(explicit[0].length) : token;
    if (explicit && root.length >= 4) roots.add(root);
    if (!negativeOnly && !explicit && token.length >= 4) roots.add(token);
    if (!negativeOnly || explicit) {
      for (const suffix of ["ness", "ment", "tion", "sion", "ity", "ing", "ed", "es", "s"]) {
        if (root.length > suffix.length + 3 && root.endsWith(suffix)) {
          roots.add(root.slice(0, -suffix.length));
        }
      }
    }
  }
  const source = normalizeText(value).toLowerCase();
  for (const match of source.matchAll(/\b(?:not|never|without|lack(?:s|ed|ing)?|absence of)\s+(?:a|an|the\s+)?([\p{L}\p{N}-]+)/gu)) {
    const concept = match[1].replace(/^-+|-+$/gu, "");
    if (concept.length >= 4) {
      roots.add(concept);
      for (const suffix of ["ness", "ment", "tion", "sion", "ity", "ing", "ed", "es", "s"]) {
        if (concept.length > suffix.length + 3 && concept.endsWith(suffix)) roots.add(concept.slice(0, -suffix.length));
      }
    }
  }
  return roots;
}

function hasPolarityConflict(sourceGlossSense, linkedSense) {
  const sourceText = [
    ...(Array.isArray(sourceGlossSense?.lemmas) ? sourceGlossSense.lemmas : []),
    sourceGlossSense?.definition
  ].join(" ");
  const linkedText = [
    ...(Array.isArray(linkedSense?.lemmas) ? linkedSense.lemmas : []),
    linkedSense?.definition
  ].join(" ");
  const sourceNegated = polarityRoots(sourceText, { negativeOnly: true });
  const linkedNegated = polarityRoots(linkedText, { negativeOnly: true });
  const sourcePositive = polarityRoots(sourceText);
  const linkedPositive = polarityRoots(linkedText);
  for (const root of sourceNegated) sourcePositive.delete(root);
  for (const root of linkedNegated) linkedPositive.delete(root);
  return [...sourceNegated].some((root) => linkedPositive.has(root))
    || [...linkedNegated].some((root) => sourcePositive.has(root));
}

function parseCompactCompoundVerification({
  payload,
  candidate,
  candidateId: selectedId,
  verdict,
  headKind,
  rationale,
  raw
}) {
  if (!candidate) {
    return {
      valid: true,
      verdict,
      candidate: null,
      candidateId: selectedId,
      headKind: headKind || "uncertain",
      rationale,
      raw
    };
  }
  const components = candidateComponents(candidate);
  const targetSenseId = normalizeText(payload.targetSenseId);
  const componentSenseIds = Array.isArray(payload.componentSenseIds)
    ? payload.componentSenseIds.map(normalizeText)
    : [];
  const sourceGlossSenseIds = Array.isArray(payload.sourceGlossSenseIds)
    ? payload.sourceGlossSenseIds.map(normalizeText)
    : [];
  const composition = normalizeText(payload.composition).toLowerCase();
  if (!["literal", "nonliteral", "uncertain"].includes(composition)) {
    return { valid: false, reason: "response composition must be literal, nonliteral, or uncertain" };
  }
  if (verdict !== "accept") {
    return {
      valid: true,
      verdict,
      candidate,
      candidateId: selectedId,
      headKind: headKind || "uncertain",
      supportingSenseId: targetSenseId,
      supportingComponentSenseIds: componentSenseIds,
      supportingSourceGlossSenseIds: sourceGlossSenseIds,
      supportingHeadSenseId: componentSenseIds.at(-1) ?? "",
      supportingModifierSenseIds: componentSenseIds.slice(0, -1),
      supportingComposition: composition,
      rationale,
      raw
    };
  }
  if (componentSenseIds.length !== components.length || sourceGlossSenseIds.length !== components.length) {
    return { valid: false, reason: "accepted response must cite one linked sense and one source-gloss slot per component in order" };
  }
  const targetSense = (candidate.targetSenseEvidence ?? []).find((sense) => (
    normalizeText(sense?.source) === targetSenseId
  ));
  if (!targetSenseId || !targetSense) {
    return { valid: false, reason: "accepted response must cite a supplied target sense source id" };
  }
  const polarityMismatches = [];
  for (const [index, component] of components.entries()) {
    const linkedSenseId = componentSenseIds[index];
    const linkedSense = (candidate.componentSenseEvidence ?? []).find((sense) => (
      normalizeText(sense?.component) === component && normalizeText(sense?.source) === linkedSenseId
    ));
    if (!linkedSenseId || !linkedSense) {
      return { valid: false, reason: "accepted response must cite a supplied linked sense for component " + JSON.stringify(component) };
    }
    const sourceGlossSenseId = sourceGlossSenseIds[index];
    const sourceGlossSense = (linkedSense.mappingLookupSenseEvidence ?? []).find((sense) => (
      normalizeText(sense?.source) === sourceGlossSenseId
    ));
    if (normalizeText(linkedSense.mappingKind) === "word-suggestion" && (!sourceGlossSenseId || !sourceGlossSense)) {
      return {
        valid: false,
        reason: "accepted word-suggestion component " + JSON.stringify(component) + " must cite its supplied source gloss sense"
      };
    }
    if (sourceGlossSenseId && !sourceGlossSense) {
      return { valid: false, reason: "source gloss sense for component " + JSON.stringify(component) + " is outside its linked sense evidence" };
    }
    if (sourceGlossSense && hasPolarityConflict(sourceGlossSense, linkedSense)) {
      polarityMismatches.push(component);
    }
  }
  const headSenseId = componentSenseIds.at(-1);
  const headRelationSupported = Array.isArray(targetSense.compatibleHeadSenseIds)
    ? targetSense.compatibleHeadSenseIds.includes(headSenseId)
    : undefined;
  if (polarityMismatches.length > 0) {
    return {
      valid: true,
      verdict: "reject",
      candidate,
      candidateId: selectedId,
      headKind,
      supportingSenseId: targetSenseId,
      supportingComponentSenseIds: componentSenseIds,
      supportingSourceGlossSenseIds: sourceGlossSenseIds,
      supportingHeadSenseId: headSenseId,
      supportingModifierSenseIds: componentSenseIds.slice(0, -1),
      supportingComposition: composition,
      ...(headRelationSupported !== undefined ? { headRelationSupported } : {}),
      rationale: "rejected: linked sense reverses source gloss polarity for " + polarityMismatches.join(", "),
      raw
    };
  }
  const downgraded = composition !== "literal"
    || headKind !== "lexical-head"
    || NON_LITERAL_EVIDENCE.test(rationale);
  return {
    valid: true,
    verdict: verdict === "accept" && downgraded ? "uncertain" : verdict,
    candidate,
    candidateId: selectedId,
    headKind: downgraded ? "uncertain" : headKind,
    supportingSenseId: targetSenseId,
    supportingComponentSenseIds: componentSenseIds,
    supportingSourceGlossSenseIds: sourceGlossSenseIds,
    supportingHeadSenseId: headSenseId,
    supportingModifierSenseIds: componentSenseIds.slice(0, -1),
    supportingComposition: composition,
    ...(headRelationSupported !== undefined ? { headRelationSupported } : {}),
    rationale: downgraded && verdict === "accept"
      ? "acceptance withheld: composition or head is not literal; " + rationale
      : rationale,
    raw
  };
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
  if (verdict !== "accept" && selectedId) {
    return { valid: false, reason: "candidateId must be empty when verdict is reject or uncertain" };
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
  const selectedCandidate = candidateMap.get(selectedId);
  if (Array.isArray(payload.componentSenseIds) || payload.composition !== undefined) {
    return parseCompactCompoundVerification({
      payload,
      candidate: selectedCandidate,
      candidateId: selectedId,
      verdict,
      headKind: headKind || "uncertain",
      rationale,
      raw: String(text ?? "")
    });
  }
  const citedSense = normalizeText(payload.targetSenseId ?? payload.target_sense_id
    ?? payload.senseId ?? payload.sense_id ?? payload.supportingSenseId ?? payload.supporting_sense_id);
  const rationaleSenseIds = [...new Set(rationale.match(/\b[nvars]:\d{8}-[nvars]\b/gu) ?? [])];
  const supportingSenseId = citedSense || (rationaleSenseIds.length === 1 ? rationaleSenseIds[0] : "");
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
    ...(Array.isArray(response.supportingComponentSenseIds)
      ? { verificationComponentSenseIds: response.supportingComponentSenseIds }
      : {}),
    ...(Array.isArray(response.supportingSourceGlossSenseIds)
      ? { verificationSourceGlossSenseIds: response.supportingSourceGlossSenseIds }
      : {}),
    ...(response.supportingComposition ? { verificationComposition: response.supportingComposition } : {}),
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
    ...(Array.isArray(response?.supportingComponentSenseIds)
      ? { verificationComponentSenseIds: response.supportingComponentSenseIds }
      : {}),
    ...(Array.isArray(response?.supportingSourceGlossSenseIds)
      ? { verificationSourceGlossSenseIds: response.supportingSourceGlossSenseIds }
      : {}),
    ...(response?.supportingComposition ? { verificationComposition: response.supportingComposition } : {}),
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
    ...(Array.isArray(response?.supportingComponentSenseIds)
      ? { verificationComponentSenseIds: response.supportingComponentSenseIds }
      : {}),
    ...(Array.isArray(response?.supportingSourceGlossSenseIds)
      ? { verificationSourceGlossSenseIds: response.supportingSourceGlossSenseIds }
      : {}),
    ...(response?.supportingComposition ? { verificationComposition: response.supportingComposition } : {}),
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

function retainNotSelected(record, classification, response, { verifierName, attempts } = {}) {
  const rejected = retainRejected(record, classification, response, { verifierName, attempts });
  return {
    ...rejected,
    status: "not-selected-llm",
    verificationStatus: "not-selected-llm",
    verificationRationale: `alternative candidate not selected: ${response?.rationale ?? response?.reason ?? "another supplied candidate was selected"}`
  };
}

function candidateGroupKey(record) {
  const senseId = normalizeText(record?.senseId ?? record?.targetSenseEvidence?.[0]?.source);
  return senseId
    ? `sense\u0000${senseId}`
    : `${normalizeText(record?.target)}\u0000${JSON.stringify(record?.sourceSurfaces ?? {})}`;
}

export function groupCompoundVerificationCandidates(records = []) {
  if (!Array.isArray(records)) throw invalid("compound verification grouping requires records");
  const groups = new Map();
  for (const [index, record] of records.entries()) {
    const key = candidateGroupKey(record);
    let group = groups.get(key);
    if (!group) {
      group = { key, index, candidates: [] };
      groups.set(key, group);
    }
    group.candidates.push(record);
  }
  return [...groups.values()];
}

export function batchCompoundVerificationGroups(groups = [], maximumRows = 32) {
  if (!Array.isArray(groups)) throw invalid("compound verification batching requires groups");
  const limit = Math.max(1, Math.trunc(Number(maximumRows) || 32));
  const batches = [];
  let batch = [];
  let rowCount = 0;
  for (const group of groups) {
    const candidates = Array.isArray(group?.candidates) ? group.candidates : [];
    if (candidates.length === 0) continue;
    if (batch.length > 0 && rowCount + candidates.length > limit) {
      batches.push(batch);
      batch = [];
      rowCount = 0;
    }
    batch.push(...candidates);
    rowCount += candidates.length;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
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
  const units = classification.records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.certainty !== "llm")
    .map(({ record, index }) => ({ index, record, candidates: [record], deterministic: true }));
  const inputIndex = new Map(classification.records.map((record, index) => [candidateId(record), index]));
  units.push(...groupCompoundVerificationCandidates(classification.verificationCandidates)
    .map((group) => ({
      index: inputIndex.get(candidateId(group.candidates[0])) ?? group.index,
      record: group.candidates[0],
      candidates: group.candidates,
      deterministic: false
    })));
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
        "Return only one corrected JSON object with verdict, candidateId, headKind, targetSenseId, componentSenseIds, sourceGlossSenseIds, composition, and rationale.",
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
        results.push(retainNotSelected(candidate, candidateClassification, response, { verifierName, attempts }));
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
    notSelected: verified.filter((record) => record.verificationStatus === "not-selected-llm"),
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
    const componentSenseIds = [...new Set((Array.isArray(candidates) && candidates.length > 0 ? candidates : [record])
      .flatMap((candidate) => {
        return Array.isArray(candidate?.componentSenseEvidence)
          ? candidate.componentSenseEvidence.map((sense) => normalizeText(sense?.source))
          : [];
      })
      .filter(Boolean))];
    const sourceGlossSenseIds = [...new Set((Array.isArray(candidates) && candidates.length > 0 ? candidates : [record])
      .flatMap((candidate) => Array.isArray(candidate?.componentSenseEvidence)
        ? candidate.componentSenseEvidence.flatMap((sense) => Array.isArray(sense?.mappingLookupSenseEvidence)
          ? sense.mappingLookupSenseEvidence.map((lookupSense) => normalizeText(lookupSense?.source))
          : [])
        : [])
      .filter(Boolean))];
    const jobSpec = {
      kind: "ollama-generate",
      prompt: String(prompt ?? ""),
      stream: false,
      think: false,
      format: {
        type: "object",
        required: ["verdict", "candidateId", "headKind", "targetSenseId", "componentSenseIds", "sourceGlossSenseIds", "composition", "rationale"],
        additionalProperties: false,
        properties: {
          verdict: { type: "string", enum: ["accept", "reject", "uncertain"] },
          candidateId: { type: "string", enum: ["", ...candidateIds] },
          headKind: { type: "string", enum: [...RESPONSE_HEAD_KINDS] },
          targetSenseId: { type: "string", enum: ["", ...senseIds] },
          componentSenseIds: {
            type: "array",
            minItems: 0,
            maxItems: 3,
            items: { type: "string", enum: ["", ...componentSenseIds] }
          },
          sourceGlossSenseIds: {
            type: "array",
            minItems: 0,
            maxItems: 3,
            items: { type: "string", enum: ["", ...sourceGlossSenseIds] }
          },
          composition: { type: "string", enum: ["literal", "nonliteral", "uncertain"] },
          rationale: { type: "string", maxLength: 120 }
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
    return queuedMindAnswer(completed?.result?.text ?? "");
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
