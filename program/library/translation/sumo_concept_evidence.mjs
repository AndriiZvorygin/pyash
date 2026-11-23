import { buildProgram } from "../../program.mjs";

export const SUMO_CONCEPT_LINKS_NAME = "sumo_concept_links";
export const SUMO_CONCEPT_LINK_FORMAT = "sumo-concept-link-v1";
export const SUMO_CONCEPT_EVIDENCE_NAME = "sumo_concept_evidence";
export const SUMO_CONCEPT_EVIDENCE_FORMAT = "sumo-concept-evidence-v1";
export const SUMO_CONCEPT_CANDIDATE_NAME = "sumo_concept_candidates";
export const SUMO_CONCEPT_CANDIDATE_FORMAT = "sumo-concept-candidate-v1";
export const SUMO_CONCEPT_DECISION_NAME = "sumo_concept_decisions";
export const SUMO_CONCEPT_DECISION_FORMAT = "sumo-concept-decision-v1";

export const SUMO_RELEASE = "WordNet 3.0 mapping snapshot f0c126842d098a312e390479b38ecfbac018f8ed";

// Relations describe the target relative to the SUMO concept, matching the
// convention already used by the derived source links.
export const SUMO_LINK_RELATIONS = Object.freeze([
  "equivalent-to",
  "subsumed-by",
  "instance-of",
  "superclass-of"
]);

// Relations a SUMO/WordNet mapping symbol can carry.
export const SUMO_CROSSWALK_RELATIONS = Object.freeze([
  "equivalent-to",
  "subsumed-by",
  "instance-of",
  "complement-of-equivalent",
  "complement-of-subsumed-by",
  "complement-of-instance"
]);

export const SUMO_CONCEPT_PATHS = Object.freeze(["surface", "hierarchy", "adjudication"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-sumo-concept-evidence";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * SUMO term formats and Pyash English forms disagree on separators and case,
 * so both sides are folded to space separated lower case before comparison.
 */
export function normalizeSumoSurface(value) {
  return text(value)
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/gu, " ")
    .trim();
}

export function sumoSurfaceWords(value) {
  return normalizeSumoSurface(value).split(" ").filter(Boolean);
}

/**
 * True when the words of `needle` appear as a contiguous run inside
 * `haystack`. "love" is contained in "companionate love", which is how a
 * head-word relationship is recognised without a model.
 */
export function sumoSurfaceContains(haystack, needle) {
  const small = sumoSurfaceWords(needle);
  const big = sumoSurfaceWords(haystack);
  if (!small.length || small.length > big.length) return false;
  for (let start = 0; start + small.length <= big.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < small.length; offset += 1) {
      if (big[start + offset] !== small[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Reads the SUMO crosswalk catalog and returns the concept universe. Every
 * concept carries its English label and its WordNet mapping rows.
 */
export function parseSumoConceptCatalog(source) {
  const program = buildProgram(text(source));
  const concepts = new Map();
  for (const sentence of program.sentences) {
    if (sentence?.mood !== "ya") continue;
    if (typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    let payload;
    try {
      payload = JSON.parse(sentence.ob.text);
    } catch {
      continue;
    }
    if (!payload || typeof payload.sumoId !== "string" || !payload.sumoId) continue;
    const concept = concepts.get(payload.sumoId) ?? { sumoId: payload.sumoId, label: "", mappings: [] };
    if (payload.kind === "sumo-concept") {
      if (!concept.label && typeof payload.label === "string") concept.label = payload.label;
    } else if (payload.kind === "wordnet-mapping") {
      concept.mappings.push(payload);
    }
    concepts.set(payload.sumoId, concept);
  }
  return concepts;
}

/**
 * Reads the reference source entries and returns the published link state:
 * which SUMO concepts are already linked, which English surfaces each Pyash
 * entry carries, and the sense glosses that support adjudication.
 */
export function buildSumoLinkIndex(entries = []) {
  const linksBySumoId = new Map();
  const sequencesBySurface = new Map();
  const entriesBySequence = new Map();
  for (const entry of entries) {
    const sequence = text(entry?.sequence).trim();
    if (!sequence) continue;
    const surfaces = [...new Set((entry.forms ?? [])
      .filter((form) => form?.language === "en")
      .map((form) => normalizeSumoSurface(form.surface))
      .filter(Boolean))];
    const senses = [...new Set((entry.sourceLinks ?? [])
      .filter((link) => link?.dataset === "wordnet")
      .map((link) => text(link.identifier).trim())
      .filter(Boolean))];
    const glosses = [...new Set((entry.sourceGlosses ?? [])
      .filter((gloss) => gloss?.dataset === "wordnet")
      .map((gloss) => text(gloss.text).trim())
      .filter(Boolean))];
    const sumoLinks = (entry.sourceLinks ?? [])
      .filter((link) => link?.dataset === "sumo")
      .map((link) => ({
        sumoId: text(link.identifier).trim(),
        relation: text(link.relation).trim(),
        sequence
      }));
    entriesBySequence.set(sequence, { sequence, surfaces, senses, glosses, sumoLinks });
    for (const surface of surfaces) {
      const list = sequencesBySurface.get(surface) ?? [];
      if (!list.includes(sequence)) list.push(sequence);
      sequencesBySurface.set(surface, list);
    }
    for (const link of sumoLinks) {
      if (!link.sumoId) continue;
      const list = linksBySumoId.get(link.sumoId) ?? [];
      list.push({ sequence: link.sequence, relation: link.relation });
      linksBySumoId.set(link.sumoId, list);
    }
  }
  return { linksBySumoId, sequencesBySurface, entriesBySequence };
}

/**
 * The unique crosswalk of a concept, when it has exactly one sense. The
 * relation it carries describes that sense relative to the concept.
 */
export function uniqueCrosswalk(concept) {
  const unique = (concept?.mappings ?? []).filter((mapping) => mapping?.crosswalkStatus === "unique");
  if (unique.length !== 1) return null;
  const mapping = unique[0];
  const senseIds = (mapping.openEnglishWordNetIds ?? []).map((value) => text(value).trim()).filter(Boolean);
  if (senseIds.length !== 1) return null;
  const relation = text(mapping.mappingRelation).trim();
  if (!SUMO_CROSSWALK_RELATIONS.includes(relation)) return null;
  return {
    senseId: senseIds[0],
    relation,
    lemmas: (mapping.lemmas ?? []).map((value) => text(value).trim()).filter(Boolean)
  };
}

/**
 * The concept's own English surface. The ontology term format is the SUMO
 * surface of record; the catalog label is the fallback.
 */
export function conceptSurface(concept, ontology) {
  const fromOntology = normalizeSumoSurface(ontology?.termFormats?.get(concept?.sumoId ?? ""));
  if (fromOntology) return fromOntology;
  return normalizeSumoSurface(concept?.label ?? "");
}

function ancestorsOf(sumoId, ontology, limit = 8) {
  const parents = (id) => ontology?.concepts?.get(id)?.subclassOf ?? [];
  const seen = new Set([sumoId]);
  const levels = [];
  let frontier = parents(sumoId);
  let depth = 0;
  while (frontier.length && depth < limit) {
    const next = [];
    for (const parent of frontier) {
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);
      next.push(parent);
    }
    if (!next.length) break;
    levels.push({ depth, ids: next });
    frontier = next.flatMap((id) => parents(id));
    depth += 1;
  }
  return levels;
}

/**
 * Builds the evidence bundle for every concept: its own surface, its
 * definition, the candidates a surface match offers, and the nearest ancestor
 * that the reference already links.
 */
export function buildSumoConceptEvidence({ concepts, ontology, linkIndex }) {
  const evidence = new Map();
  for (const concept of concepts.values()) {
    const surface = conceptSurface(concept, ontology);
    const crosswalk = uniqueCrosswalk(concept);
    const published = linkIndex?.linksBySumoId?.get(concept.sumoId) ?? [];
    const candidateSequences = surface ? (linkIndex?.sequencesBySurface?.get(surface) ?? []) : [];
    const candidates = candidateSequences.map((sequence) => {
      const entry = linkIndex?.entriesBySequence?.get(sequence) ?? { sequence, surfaces: [], senses: [], glosses: [] };
      return {
        sequence,
        surfaces: entry.surfaces,
        senses: entry.senses,
        glosses: entry.glosses,
        carriesCrosswalkSense: Boolean(crosswalk && entry.senses.includes(crosswalk.senseId))
      };
    });
    let hierarchy = null;
    for (const level of ancestorsOf(concept.sumoId, ontology)) {
      for (const ancestorId of level.ids) {
        const ancestorLinks = linkIndex?.linksBySumoId?.get(ancestorId) ?? [];
        const equivalent = ancestorLinks.find((link) => link.relation === "equivalent-to");
        if (!equivalent) continue;
        const ancestorSurface = normalizeSumoSurface(ontology?.termFormats?.get(ancestorId) ?? "");
        hierarchy = {
          ancestorSumoId: ancestorId,
          ancestorSurface,
          sequence: equivalent.sequence,
          depth: level.depth,
          affinity: ancestorSurface && sumoSurfaceContains(surface, ancestorSurface)
            ? "head-word"
            : "class-only"
        };
        break;
      }
      if (hierarchy) break;
    }
    const covered = published.some((link) => {
      const entry = linkIndex?.entriesBySequence?.get(link.sequence);
      return (entry?.surfaces ?? []).some((form) => form === surface);
    });
    evidence.set(concept.sumoId, {
      sumoId: concept.sumoId,
      label: concept.label,
      surface,
      definition: text(ontology?.concepts?.get(concept.sumoId)?.definition),
      crosswalk,
      publishedLinks: published,
      candidates,
      hierarchy,
      covered,
      path: covered ? "covered" : candidates.length ? "surface" : hierarchy ? "hierarchy" : "adjudication"
    });
  }
  return evidence;
}

/**
 * Resolves a concept against the evidence that needs no model judgment. A
 * single surface candidate is deterministic; several candidates need
 * adjudication; a hierarchy ancestor is a sound subsumption claim.
 */
export function resolveSumoConceptEvidence(evidence) {
  if (!evidence) throw invalid("SUMO concept evidence is required");
  if (evidence.covered) {
    return { status: "covered", reason: "already linked to the entry carrying its own surface", relation: "", sequence: "" };
  }
  if (evidence.candidates.length === 1) {
    const candidate = evidence.candidates[0];
    const relation = candidate.carriesCrosswalkSense
      ? evidence.crosswalk.relation
      : "equivalent-to";
    return {
      status: "resolved",
      path: "surface",
      relation,
      sequence: candidate.sequence,
      reason: candidate.carriesCrosswalkSense
        ? "own surface matches one entry and carries the crosswalk sense"
        : "own surface matches one entry"
    };
  }
  if (evidence.candidates.length > 1) {
    return {
      status: "needs-adjudication",
      path: "surface",
      relation: "",
      sequence: "",
      reason: "own surface matches several entries"
    };
  }
  if (evidence.hierarchy) {
    return {
      status: "resolved",
      path: "hierarchy",
      relation: "superclass-of",
      sequence: evidence.hierarchy.sequence,
      reason: `nearest ancestor ${evidence.hierarchy.ancestorSumoId} is linked equivalent-to`
    };
  }
  return {
    status: "needs-adjudication",
    path: "adjudication",
    relation: "",
    sequence: "",
    reason: "no surface match and no linked ancestor"
  };
}

/**
 * The relation a chosen target carries. A target that holds the concept's
 * unique crosswalk sense keeps that crosswalk's relation; any other target
 * keeps the surface or subsumption claim the evidence supports.
 */
export function relationForTarget(evidence, target, proposed = "") {
  const crosswalk = evidence?.crosswalk;
  const senses = target?.senses ?? [];
  if (crosswalk && senses.includes(crosswalk.senseId)) return crosswalk.relation;
  if (SUMO_LINK_RELATIONS.includes(proposed)) return proposed;
  return "equivalent-to";
}

/**
 * Renders an accepted link as a catalog row. SUMO definitions stay out of
 * the record; only identifiers, the relation, and the evidence survive.
 */
export function buildSumoConceptLinkRecord({ concept, evidence, resolution }) {
  if (!resolution || resolution.status !== "resolved") {
    throw invalid("SUMO concept link requires a resolved outcome", { resolution });
  }
  const relation = resolution.relation;
  if (!SUMO_LINK_RELATIONS.includes(relation)) {
    throw invalid("SUMO concept link relation is not supported", { relation });
  }
  return {
    recordId: `sumo-link:${concept.sumoId}`,
    kind: "sumo-concept-link",
    sumoId: concept.sumoId,
    label: evidence?.label || concept.label || "",
    surface: evidence?.surface || "",
    pyashSequence: String(resolution.sequence).split(" ").filter(Boolean),
    relation,
    evidence: {
      path: resolution.path,
      reason: resolution.reason,
      crosswalkSenseId: evidence?.crosswalk?.senseId ?? "",
      crosswalkRelation: evidence?.crosswalk?.relation ?? "",
      ancestorSumoId: evidence?.hierarchy?.ancestorSumoId ?? "",
      ancestorSurface: evidence?.hierarchy?.ancestorSurface ?? "",
      hierarchyDepth: evidence?.hierarchy?.depth ?? null,
      affinity: evidence?.hierarchy?.affinity ?? ""
    },
    provenance: SUMO_RELEASE
  };
}

export function renderSumoConceptLinkRows(records = []) {
  const lines = [
    `su name ${SUMO_CONCEPT_LINKS_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(SUMO_CONCEPT_LINK_FORMAT)} ya`
  ];
  for (const record of records) {
    lines.push(`su text ${JSON.stringify(record.recordId)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

export function parseSumoConceptLinkRows(source) {
  const program = buildProgram(text(source));
  const records = [];
  for (const sentence of program.sentences) {
    if (sentence?.mood !== "ya") continue;
    if (typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    if (sentence.su.text === "format") continue;
    let payload;
    try {
      payload = JSON.parse(sentence.ob.text);
    } catch {
      continue;
    }
    if (payload?.kind === "sumo-concept-link") records.push(payload);
  }
  return records;
}
