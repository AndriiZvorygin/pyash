import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import { getRefinery, runRefinery } from "../../bridge/refinery.mjs";
import { doRemember, forget, remember } from "../../remember/index.mjs";
import { interpret } from "../../bridge/index.mjs";
import { parse } from "../../understand/index.mjs";
import { resolveConfigText } from "../../configure/env.mjs";
import { builtInSignatures } from "../../verbs/index.mjs";
import { clearSignatureHandlers, registerSignatureHandler } from "../../bridge/signature.mjs";
import { createGpuHousekeeperAdapter } from "../../runtime/gpu/housekeeper_adapter.mjs";
import { recordExchangeJsonArtifact } from "../../bridge/exchange.mjs";
import { loadEnglish30k, english30kLookupVariants } from "./english30k_coverage.mjs";
import { loadSumoOntology, SUMO_ONTOLOGY_COMMIT } from "./sumo_ontology.mjs";
import {
  SUMO_CONCEPT_CANDIDATE_FORMAT,
  SUMO_CONCEPT_CANDIDATE_NAME,
  SUMO_CONCEPT_DECISION_FORMAT,
  SUMO_CONCEPT_DECISION_NAME,
  SUMO_CONCEPT_EVIDENCE_FORMAT,
  SUMO_CONCEPT_EVIDENCE_NAME,
  SUMO_CONCEPT_LINKS_NAME,
  SUMO_CONCEPT_LINK_FORMAT,
  SUMO_LINK_RELATIONS,
  SUMO_RELEASE,
  buildSumoConceptEvidence,
  buildSumoConceptLinkRecord,
  buildSumoLinkIndex,
  normalizeSumoSurface,
  parseSumoConceptCatalog,
  parseSumoConceptLinkRows,
  relationForTarget,
  renderSumoConceptLinkRows,
  resolveSumoConceptEvidence,
  sumoSurfaceContains
} from "./sumo_concept_evidence.mjs";
import {
  buildAcceptedReferenceSource,
  loadReferenceSourceInputs
} from "../dictionary/build_reference_source.mjs";

export const SUMO_CONCEPT_REFINERY_NAME = "translation concept mapping";
export const SUMO_CONCEPT_CONFIG_URL = new URL("./sumo_concept_refinery.pya", import.meta.url);
export const SUMO_CONCEPT_LINKS_URL = new URL("./sumo_concept_links.pya", import.meta.url);
export const SUMO_CONCEPT_PROMPT_REVISION = "sumo-concept-link-v1";
export const SUMO_CONCEPT_MAX_OUTPUT_TOKENS = 512;
export const SUMO_CONCEPT_PARALLELISM = 8;
export const SUMO_CONCEPT_DEFAULT_MODEL = "qwen3.5:9b";
export const SUMO_CONCEPT_ONTOLOGY_DIRECTORIES = Object.freeze([
  "know/sumo/ontology",
  "know/sumo"
]);

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-sumo-concept-refinery";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

export function sumoConceptRunId({ sourceHash, promptRevision = SUMO_CONCEPT_PROMPT_REVISION } = {}) {
  return `sumo-concept-sweep-${hash(`${sourceHash}\u0000${promptRevision}`).slice(0, 24)}`;
}

export function parseSumoConceptConfig(source) {
  const sentences = buildProgram(text(source)).sentences;
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    const key = sentence.su.text.startsWith("meta:") ? sentence.su.text.slice(5) : sentence.su.text;
    if (key === "format") {
      metadata.format = text(sentence.ob?.text);
      continue;
    }
    const value = sentence.ob?.text;
    const count = sentence.ob?.num;
    metadata[key] = typeof value === "string" ? value : typeof count === "number" ? count : "";
  }
  if (!metadata.format) throw invalid("SUMO concept refinery config has no format");
  return {
    format: metadata.format,
    model: text(metadata.model) || SUMO_CONCEPT_DEFAULT_MODEL,
    promptRevision: text(metadata["prompt-revision"]) || SUMO_CONCEPT_PROMPT_REVISION,
    maxOutputTokens: Number(metadata["max-output-tokens"]) || SUMO_CONCEPT_MAX_OUTPUT_TOKENS,
    parallelism: Number(metadata.parallelism) || SUMO_CONCEPT_PARALLELISM,
    maximumConcepts: Number(metadata["max-concepts-per-launch"]) || 64,
    candidateLimit: Number(metadata["candidate-limit"]) || 8,
    hierarchyDepthLimit: Number(metadata["hierarchy-depth-limit"]) || 6,
    worklistOrder: text(metadata["worklist-order"]) || "english30k-rank",
    pilotConceptIds: text(metadata["pilot-concept-ids"])
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

/**
 * The pilot selection lives in the refinery config so a pilot runs without a
 * command line switch and stays reviewable.
 */
export async function readSumoConceptPilotIds({ configUrl = SUMO_CONCEPT_CONFIG_URL } = {}) {
  const config = parseSumoConceptConfig(await readFile(configUrl, "utf8"));
  return config.pilotConceptIds;
}

/**
 * The run id is derived from the source identities and the prompt revision, so
 * the caller can attach its exchange recorder before the first batch.
 */
export async function sumoConceptRunIdForState({
  dependencies = {},
  repositoryRoot = REPOSITORY_ROOT,
  configUrl = SUMO_CONCEPT_CONFIG_URL,
  sweepState = {}
} = {}) {
  const config = parseSumoConceptConfig(await readFile(configUrl, "utf8"));
  const state = sweepState.sumoState ?? (sweepState.sumoState = await loadSumoConceptState({ dependencies, repositoryRoot }));
  return { runId: sumoConceptRunId({ sourceHash: state.sourceHash, promptRevision: config.promptRevision }), sweepState, config };
}

/**
 * The concept's own words, used to find entries that share its head word.
 */
function headWord(surface) {
  const words = normalizeSumoSurface(surface).split(" ").filter(Boolean);
  return words.length ? words[words.length - 1] : "";
}

/**
 * A bounded candidate set for a concept that no deterministic path resolved.
 * The head word keeps the set small and relevant, and the nearest ancestors
 * supply the class level candidates.
 */
export function buildAdjudicationCandidates(evidence, linkIndex, limit = 8) {
  const head = headWord(evidence.surface);
  const candidates = [];
  const seen = new Set();
  const push = (sequence, reason) => {
    if (!sequence || seen.has(sequence) || candidates.length >= limit) return;
    seen.add(sequence);
    const entry = linkIndex.entriesBySequence.get(sequence) ?? { sequence, surfaces: [], senses: [], glosses: [] };
    candidates.push({
      sequence,
      surfaces: entry.surfaces,
      senses: entry.senses,
      glosses: entry.glosses,
      reason
    });
  };
  if (head) {
    for (const sequence of linkIndex.sequencesBySurface.get(head) ?? []) push(sequence, "head word");
  }
  if (evidence.hierarchy) push(evidence.hierarchy.sequence, "linked ancestor");
  return candidates;
}

/**
 * The adjudication prompt. The model chooses one supplied candidate or none.
 * It never writes a relation that the evidence does not support.
 */
export function buildSumoConceptPrompt({ concept, evidence, candidates = [] }) {
  const lines = [
    "You match a SUMO ontology concept to Pyash vocabulary.",
    "",
    `SUMO concept: ${concept.sumoId}`,
    `English surface: ${evidence.surface || "(none)"}`,
    `Definition: ${evidence.definition || "(none)"}`,
    ""
  ];
  if (!candidates.length) {
    lines.push("There are no candidate Pyash entries for this concept.");
  } else {
    lines.push("Candidate Pyash entries:");
    candidates.forEach((candidate, index) => {
      const forms = candidate.surfaces.length ? candidate.surfaces.join(", ") : "(no English form)";
      const glosses = candidate.glosses.length ? candidate.glosses.join(" | ") : "(no gloss)";
      lines.push(`${index + 1}. sequence "${candidate.sequence}" [${candidate.reason}]`);
      lines.push(`   English forms: ${forms}`);
      lines.push(`   Sense gloss: ${glosses}`);
    });
  }
  lines.push(
    "",
    "Choose the one candidate entry that the SUMO concept denotes.",
    "Reply \"none\" when no candidate denotes the concept.",
    "",
    "The relation describes the chosen entry relative to the SUMO concept:",
    "- equivalent-to: the entry means the same as the concept",
    "- subsumed-by: the entry is a more specific sense of the concept",
    "- instance-of: the entry is an instance of the concept",
    "- superclass-of: the entry is a broader class than the concept",
    "",
    'Reply with JSON: {"choice": "<candidate sequence or none>", "relation": "<relation>", "reason": "<one short sentence>"}'
  );
  return lines.join("\n");
}

export function buildSumoConceptResponseFormat() {
  return {
    type: "object",
    properties: {
      choice: { type: "string" },
      relation: { type: "string" },
      reason: { type: "string" }
    },
    required: ["choice", "relation", "reason"]
  };
}

/**
 * Validates a model answer against the candidates it was given. An answer
 * that names an unknown candidate, an unsupported relation, or a relation the
 * crosswalk contradicts stays uncertain rather than being repaired.
 */
/**
 * The Housekeeper returns the provider envelope, so the answer can sit inside
 * `response` or `message.content` rather than at the top level.
 */
export function unwrapSumoConceptAnswer(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.choice !== undefined) return payload;
  const wrapped = typeof payload.response === "string"
    ? payload.response
    : typeof payload.message?.content === "string" ? payload.message.content : "";
  if (!wrapped) return payload;
  try {
    const inner = JSON.parse(wrapped);
    return inner && typeof inner === "object" ? inner : payload;
  } catch {
    return payload;
  }
}

export function parseSumoConceptChoiceResponse(value, { evidence, candidates = [] } = {}) {
  const payload = unwrapSumoConceptAnswer(value);
  if (!payload) {
    return { status: "uncertain", reason: "model answer is not JSON", choice: "", relation: "" };
  }
  const choice = text(payload?.choice).trim();
  const relation = text(payload?.relation).trim();
  const reason = text(payload?.reason).trim();
  if (!choice) return { status: "uncertain", reason: "model answer has no choice", choice: "", relation };
  if (choice.toLowerCase() === "none") {
    return { status: "rejected", reason: reason || "no candidate denotes the concept", choice: "", relation: "" };
  }
  let candidate = candidates.find((entry) => entry.sequence === choice);
  if (!candidate && /^[0-9]+$/u.test(choice)) {
    // The prompt numbers the candidates, so a model may answer with a number.
    const index = Number(choice) - 1;
    if (index >= 0 && index < candidates.length) candidate = candidates[index];
  }
  if (!candidate) {
    return { status: "uncertain", reason: `model named an unsupplied candidate ${choice}`, choice, relation: "" };
  }
  if (!SUMO_LINK_RELATIONS.includes(relation)) {
    return { status: "uncertain", reason: `model named an unsupported relation ${relation}`, choice, relation: "" };
  }
  const crosswalk = evidence?.crosswalk;
  if (crosswalk && candidate.senses.includes(crosswalk.senseId) && relation !== crosswalk.relation) {
    return {
      status: "uncertain",
      reason: `model relation ${relation} contradicts the crosswalk relation ${crosswalk.relation}`,
      choice,
      relation: ""
    };
  }
  const settled = relationForTarget(evidence, candidate, relation);
  return {
    status: "accepted",
    reason: reason || "model chose one candidate",
    choice: candidate.sequence,
    relation: settled
  };
}

function serializedInterpreter(interpret) {
  let chain = Promise.resolve();
  return (sentence) => {
    chain = chain.then(() => interpret(sentence));
    return chain;
  };
}

export function createQueuedMindSumoConceptChoiceTransport({
  interpret,
  parse,
  model = SUMO_CONCEPT_DEFAULT_MODEL,
  maxOutputTokens = SUMO_CONCEPT_MAX_OUTPUT_TOKENS,
  timeoutMs = 1800000
} = {}) {
  if (typeof interpret !== "function" || typeof parse !== "function") {
    throw invalid("queued SUMO concept chooser requires Pyash interpret and parse functions");
  }
  const runInterpret = serializedInterpreter(interpret);
  const waitMs = Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000));
  return async ({ input, handleId, attempt = 1 } = {}) => {
    if (!input?.prompt) throw invalid("queued SUMO concept chooser requires a prepared prompt");
    const id = text(handleId) || `sumo-concept-choice-${hash(input.prompt).slice(0, 20)}`;
    const jobSpec = {
      kind: "ollama-generate",
      prompt: String(input.prompt),
      model,
      stream: false,
      think: false,
      format: input.responseFormat ?? buildSumoConceptResponseFormat(),
      options: {
        temperature: 0,
        num_predict: Math.max(64, Math.trunc(Number(maxOutputTokens) || SUMO_CONCEPT_MAX_OUTPUT_TOKENS))
      }
    };
    const queuedHandle = `${id}-${Math.max(1, Math.trunc(Number(attempt) || 1))}`;
    recordExchangeJsonArtifact({
      identity: queuedHandle,
      label: "request",
      producer: "gpu mind request",
      payload: { handleId: queuedHandle, job: jobSpec }
    });
    const started = await runInterpret(parse(
      `su name ${JSON.stringify(queuedHandle)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    if (text(started?.ob?.text) !== "queued") {
      throw invalid("Housekeeper did not queue the SUMO concept prompt", { handleId: queuedHandle, response: started });
    }
    const completed = await runInterpret(parse(
      `accordingto text ${JSON.stringify(queuedHandle)} during num ${waitMs} vyah await be gpu do`
    ));
    recordExchangeJsonArtifact({
      identity: queuedHandle,
      label: "response",
      producer: "gpu mind response",
      payload: {
        handleId: text(queuedHandle),
        status: text(completed?.ob?.text),
        result: completed?.result ?? null
      }
    });
    if (text(completed?.ob?.text) !== "success") {
      throw invalid("Housekeeper SUMO concept duty did not complete successfully", { handleId: queuedHandle, response: completed });
    }
    return text(completed?.result?.text);
  };
}

function mapFact(name, map, filename = "") {
  return {
    mood: "ya",
    su: { name },
    be: "map",
    ob: {
      map,
      ...(filename ? { filename } : {})
    }
  };
}

function outputHandle(sentence) {
  const name = text(sentence?.to?.name);
  if (!name) throw invalid("SUMO concept stage requires a named map output", { sentence });
  return name;
}

function mapValue(name) {
  return remember(name)?.ob?.map ?? {};
}

function renderRowsPya(name, format, records = [], metadata = {}) {
  const lines = [`su name ${name} be map def`, `su text "format" ob text ${JSON.stringify(format)} ya`];
  for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`su text ${JSON.stringify(`meta:${key}`)} ob text ${JSON.stringify(String(value))} ya`);
  }
  for (const record of records) {
    const id = text(record?.id);
    if (!id) throw invalid("SUMO concept artifact row has no stable identity", { name });
    lines.push(`su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

const METADATA_KEYS = new Set(["format"]);

export function parseSumoConceptRowsPya(source, expectedName) {
  const sentences = buildProgram(text(source)).sentences;
  const records = [];
  let hasHeader = false;
  for (const sentence of sentences) {
    if (sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name === expectedName) {
      hasHeader = true;
      continue;
    }
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text === "format" || sentence.su.text.startsWith("meta:")) continue;
    if (typeof sentence.ob?.text !== "string") continue;
    let record;
    try {
      record = JSON.parse(sentence.ob.text);
    } catch {
      continue;
    }
    if (record && typeof record.id === "string") records.push(record);
  }
  if (!hasHeader) throw invalid("SUMO concept artifact has no expected Pyash map", { expectedName });
  return records;
}

async function readRowsPyaFile(artifactPath, expectedName) {
  try {
    if ((await stat(artifactPath)).size === 0) return [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  const input = createReadStream(artifactPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    for (const record of parseSumoConceptRowsPya(line, expectedName)) records.push(record);
  }
  return records;
}

async function writeRowsPyaFile(artifactPath, name, format, records, metadata = {}) {
  await mkdir(resolve(artifactPath, ".."), { recursive: true });
  await writeFile(artifactPath, renderRowsPya(name, format, records, metadata), "utf8");
}

export async function appendSumoConceptRowsPyaFile(artifactPath, name, format, records, metadata = {}) {
  if (!records.length) return;
  await mkdir(resolve(artifactPath, ".."), { recursive: true });
  const lines = [];
  for (const record of records) {
    const id = text(record?.id);
    if (!id) throw invalid("SUMO concept artifact row has no stable identity", { name });
    lines.push(`su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  let existing = "";
  try {
    existing = await readFile(artifactPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!existing.trim()) {
    const header = [`su name ${name} be map def`, `su text "format" ob text ${JSON.stringify(format)} ya`];
    for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
      header.push(`su text ${JSON.stringify(`meta:${key}`)} ob text ${JSON.stringify(String(value))} ya`);
    }
    await writeFile(artifactPath, `${header.join("\n")}\n${lines.join("\n")}\n`, "utf8");
    return;
  }
  await appendFile(artifactPath, `${lines.join("\n")}\n`, "utf8");
}

function buildEnglishRankIndex(rows = []) {
  const ranks = new Map();
  for (const row of rows) {
    for (const variant of english30kLookupVariants(row.word)) {
      const prior = ranks.get(variant);
      if (prior === undefined || row.rank < prior) ranks.set(variant, row.rank);
    }
  }
  return (value) => english30kLookupVariants(value)
    .map((variant) => ranks.get(variant))
    .filter(Number.isSafeInteger)
    .reduce((best, rank) => Math.min(best, rank), Number.POSITIVE_INFINITY);
}

async function resolveOntologyDirectory({ dependencies = {}, repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (typeof dependencies.loadOntology === "function") {
    return dependencies.loadOntology();
  }
  const configured = text(process.env.PYA_SUMO_ONTOLOGY_DIRECTORY || "");
  const candidates = configured ? [configured] : SUMO_CONCEPT_ONTOLOGY_DIRECTORIES.map((name) => join(repositoryRoot, name));
  const failures = [];
  for (const directory of candidates) {
    try {
      return await loadSumoOntology({ directory });
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw invalid("SUMO concept refinery needs the pinned SUMO ontology checkout", { failures });
}

export async function loadSumoConceptState({ dependencies = {}, repositoryRoot = REPOSITORY_ROOT } = {}) {
  const ontology = await resolveOntologyDirectory({ dependencies, repositoryRoot });
  const catalogSource = typeof dependencies.readCatalog === "function"
    ? await dependencies.readCatalog()
    : await readFile(join(repositoryRoot, "know/sumo/pyash_wordnet_mappings.pya"), "utf8");
  const concepts = parseSumoConceptCatalog(catalogSource);
  const inputs = typeof dependencies.loadReferenceInputs === "function"
    ? await dependencies.loadReferenceInputs()
    : await loadReferenceSourceInputs();
  const { entries } = buildAcceptedReferenceSource({ ...inputs, render: false });
  const linkIndex = buildSumoLinkIndex(entries);
  const promoted = typeof dependencies.readPromotedLinks === "function"
    ? await dependencies.readPromotedLinks()
    : await readFile(SUMO_CONCEPT_LINKS_URL, "utf8").catch(() => "");
  const promotedRecords = promoted ? parseSumoConceptLinkRows(promoted) : [];
  const promotedBySumoId = new Map(promotedRecords.map((record) => [record.sumoId, record]));
  const evidence = buildSumoConceptEvidence({ concepts, ontology, linkIndex });
  for (const [sumoId, record] of promotedBySumoId) {
    const entry = evidence.get(sumoId);
    if (!entry) continue;
    entry.promotedLink = record;
    entry.covered = true;
    entry.path = "covered";
  }
  const english30k = typeof dependencies.loadEnglish30k === "function"
    ? await dependencies.loadEnglish30k()
    : await loadEnglish30k();
  const rankForEnglish = buildEnglishRankIndex(english30k.rows ?? []);
  // The promoted catalog grows while a sweep runs, so it stays out of the
  // source hash: the run id has to survive a promotion.
  return { ontology, concepts, linkIndex, evidence, promotedRecords, rankForEnglish, sourceHash: hash(stableJson({
    ontology: SUMO_ONTOLOGY_COMMIT,
    concepts: concepts.size,
    entries: entries.length
  })) };
}

/**
 * Orders the worklist. The best English30k rank available for a concept comes
 * from its own surface, then from its crosswalk lemmas, then from the entry
 * its hierarchy path reaches. Concepts without a rank keep a stable place at
 * the end of the order.
 */
export function orderSumoConceptWorklist(evidenceById, rankForEnglish, { limit = 64, conceptIds = null } = {}) {
  const rows = [];
  for (const evidence of evidenceById.values()) {
    if (evidence.covered) continue;
    const resolution = resolveSumoConceptEvidence(evidence);
    if (resolution.status === "covered") continue;
    const surfaces = [evidence.surface, ...(evidence.crosswalk?.lemmas ?? [])];
    if (evidence.hierarchy) surfaces.push(evidence.hierarchy.ancestorSurface);
    let rank = Number.POSITIVE_INFINITY;
    for (const surface of surfaces) {
      if (!surface) continue;
      const value = rankForEnglish(surface);
      if (Number.isSafeInteger(value) && value < rank) rank = value;
    }
    rows.push({
      sumoId: evidence.sumoId,
      rank: Number.isSafeInteger(rank) ? rank : Number.MAX_SAFE_INTEGER,
      path: resolution.path,
      resolution
    });
  }
  rows.sort((left, right) => left.rank - right.rank || left.sumoId.localeCompare(right.sumoId));
  const selected = conceptIds ? rows.filter((row) => conceptIds.has(row.sumoId)) : rows.slice(0, limit);
  return { rows: selected, total: rows.length };
}

/**
 * Merges accepted links into the promoted catalog. Rows keep their stable
 * identity, so a later run replaces an earlier decision for the same concept
 * instead of appending a duplicate.
 */
export async function promoteSumoConceptLinks(records = [], { catalogUrl = SUMO_CONCEPT_LINKS_URL } = {}) {
  const path = catalogUrl instanceof URL ? fileURLToPath(catalogUrl) : String(catalogUrl);
  let existing = [];
  try {
    existing = parseSumoConceptLinkRows(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const byId = new Map(existing.map((record) => [record.recordId, record]));
  for (const record of records) byId.set(record.recordId, record);
  const ordered = [...byId.values()].sort((left, right) => left.recordId.localeCompare(right.recordId));
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, renderSumoConceptLinkRows(ordered), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, path);
  return { path, count: ordered.length, added: ordered.length - existing.length };
}

async function selectConcepts({ context, dependencies }) {
  const state = context.sumoState ?? (context.sumoState = await loadSumoConceptState({
    dependencies,
    repositoryRoot: context.repositoryRoot
  }));
  const requested = context.config.conceptIds;
  const selection = orderSumoConceptWorklist(state.evidence, state.rankForEnglish, {
    limit: context.config.maximumConcepts,
    conceptIds: requested ? new Set(requested) : null
  });
  const worklistPath = join(context.artifactDirectory, "concept-worklist.pya");
  const records = selection.rows.map((row) => {
    const evidence = state.evidence.get(row.sumoId);
    return {
      id: `concept:${row.sumoId}`,
      sumoId: row.sumoId,
      label: evidence.label,
      surface: evidence.surface,
      rank: row.rank === Number.MAX_SAFE_INTEGER ? "" : String(row.rank),
      path: row.path,
      definition: evidence.definition,
      crosswalkSenseId: evidence.crosswalk?.senseId ?? "",
      crosswalkRelation: evidence.crosswalk?.relation ?? "",
      candidateSequences: evidence.candidates.map((candidate) => candidate.sequence),
      ancestorSumoId: evidence.hierarchy?.ancestorSumoId ?? "",
      ancestorSequence: evidence.hierarchy?.sequence ?? "",
      ancestorAffinity: evidence.hierarchy?.affinity ?? "",
      resolution: row.resolution
    };
  });
  await writeRowsPyaFile(worklistPath, SUMO_CONCEPT_EVIDENCE_NAME, SUMO_CONCEPT_EVIDENCE_FORMAT, records, {
    "source-hash": state.sourceHash,
    "ontology-commit": SUMO_ONTOLOGY_COMMIT,
    "worklist-order": context.config.worklistOrder,
    "eligible-concept-count": String(selection.total),
    "selected-concept-count": String(records.length)
  });
  return {
    "worklist-path": worklistPath,
    "selected-concept-count": records.length,
    "remaining-concept-count": Math.max(0, selection.total - records.length),
    "eligible-concept-count": selection.total,
    "source-hash": state.sourceHash
  };
}

async function resolveCandidates({ context, dependencies }) {
  const state = context.sumoState ?? (context.sumoState = await loadSumoConceptState({
    dependencies,
    repositoryRoot: context.repositoryRoot
  }));
  const worklist = context.worklist ?? parseSumoConceptRowsPya(
    await readFile(mapValue("concept mapping")["worklist-path"], "utf8"),
    SUMO_CONCEPT_EVIDENCE_NAME
  );
  const candidatePath = join(context.artifactDirectory, "concept-candidates.pya");
  const failurePath = join(context.artifactDirectory, "adjudication-failures.pya");
  const existing = await readRowsPyaFile(candidatePath, SUMO_CONCEPT_CANDIDATE_NAME);
  const done = new Map(existing.map((record) => [record.sumoId, record]));
  const transport = context.dependencies.choiceTransport
    ?? createQueuedMindSumoConceptChoiceTransport({
      interpret: context.interpretFn,
      parse: context.parseFn,
      model: context.config.model,
      maxOutputTokens: context.config.maxOutputTokens
    });
  const pending = worklist.filter((row) => !done.has(row.sumoId));
  const width = Math.max(1, Math.trunc(Number(context.config.parallelism) || 1));
  const resolved = [];
  const failures = [];
  for (let start = 0; start < pending.length; start += width) {
    const wave = pending.slice(start, start + width);
    const outcomes = await Promise.all(wave.map(async (row) => {
      const evidence = state.evidence.get(row.sumoId);
      const resolution = resolveSumoConceptEvidence(evidence);
      if (resolution.status === "resolved") {
        return {
          id: `candidate:${row.sumoId}`,
          sumoId: row.sumoId,
          status: "resolved",
          path: resolution.path,
          sequence: resolution.sequence,
          relation: resolution.relation,
          reason: resolution.reason,
          candidates: evidence.candidates.map((candidate) => candidate.sequence),
          promptRevision: context.config.promptRevision
        };
      }
      const candidates = evidence.candidates.length
        ? evidence.candidates.map((candidate) => ({
          sequence: candidate.sequence,
          surfaces: candidate.surfaces,
          senses: candidate.senses,
          glosses: candidate.glosses,
          reason: "own surface"
        }))
        : buildAdjudicationCandidates(evidence, state.linkIndex, context.config.candidateLimit);
      if (!candidates.length) {
        return {
          id: `candidate:${row.sumoId}`,
          sumoId: row.sumoId,
          status: "no-candidate",
          path: resolution.path,
          sequence: "",
          relation: "",
          reason: "no candidate entry and no linked ancestor",
          candidates: [],
          promptRevision: context.config.promptRevision
        };
      }
      const input = {
        prompt: buildSumoConceptPrompt({ concept: { sumoId: row.sumoId }, evidence, candidates }),
        responseFormat: buildSumoConceptResponseFormat()
      };
      try {
        const answer = await transport({ input, handleId: `sumo-concept-${row.sumoId}` });
        const parsed = parseSumoConceptChoiceResponse(answer, { evidence, candidates });
        return {
          id: `candidate:${row.sumoId}`,
          sumoId: row.sumoId,
          status: parsed.status === "accepted" ? "resolved" : parsed.status,
          path: resolution.path,
          sequence: parsed.choice || "",
          relation: parsed.relation || "",
          reason: parsed.reason,
          candidates: candidates.map((candidate) => candidate.sequence),
          promptRevision: context.config.promptRevision
        };
      } catch (error) {
        let answer = "";
        let lastError = error;
        for (let attempt = 2; attempt <= 3; attempt += 1) {
          try {
            answer = await transport({ input, handleId: `sumo-concept-${row.sumoId}`, attempt });
            lastError = null;
            break;
          } catch (retryError) {
            lastError = retryError;
          }
        }
        if (lastError) {
          return {
            id: `candidate:${row.sumoId}`,
            sumoId: row.sumoId,
            status: "failed",
            path: resolution.path,
            sequence: "",
            relation: "",
            reason: text(lastError?.message) || "model call failed",
            candidates: candidates.map((candidate) => candidate.sequence),
            promptRevision: context.config.promptRevision
          };
        }
        const retried = parseSumoConceptChoiceResponse(answer, { evidence, candidates });
        return {
          id: `candidate:${row.sumoId}`,
          sumoId: row.sumoId,
          status: retried.status === "accepted" ? "resolved" : retried.status,
          path: resolution.path,
          sequence: retried.choice || "",
          relation: retried.relation || "",
          reason: retried.reason,
          candidates: candidates.map((candidate) => candidate.sequence),
          promptRevision: context.config.promptRevision
        };
      }
    }));
    for (const outcome of outcomes) {
      resolved.push(outcome);
      if (outcome.status === "failed") failures.push(outcome);
    }
    await appendSumoConceptRowsPyaFile(candidatePath, SUMO_CONCEPT_CANDIDATE_NAME, SUMO_CONCEPT_CANDIDATE_FORMAT, resolved.slice(-wave.length), {
      "prompt-revision": context.config.promptRevision,
      "model": context.config.model
    });
  }
  if (failures.length) {
    await appendSumoConceptRowsPyaFile(failurePath, "sumo_concept_adjudication_failures", "sumo-concept-adjudication-failure-v1", failures, {
      "prompt-revision": context.config.promptRevision,
      "model": context.config.model
    });
  }
  return {
    "candidate-path": candidatePath,
    "failure-path": failurePath,
    "candidate-count": resolved.length,
    "failure-count": failures.length
  };
}

async function verifyLinks({ context, dependencies }) {
  const state = context.sumoState ?? (context.sumoState = await loadSumoConceptState({
    dependencies,
    repositoryRoot: context.repositoryRoot
  }));
  const candidates = context.candidates ?? parseSumoConceptRowsPya(
    await readFile(mapValue("concept mapping rows")["candidate-path"], "utf8"),
    SUMO_CONCEPT_CANDIDATE_NAME
  );
  const decisionPath = join(context.artifactDirectory, "concept-decisions.pya");
  const decisions = [];
  const accepted = [];
  for (const candidate of candidates) {
    const evidence = state.evidence.get(candidate.sumoId);
    if (!evidence) continue;
    if (candidate.status !== "resolved" || !candidate.sequence) {
      decisions.push({
        id: `decision:${candidate.sumoId}`,
        sumoId: candidate.sumoId,
        status: candidate.status === "rejected" ? "rejected" : candidate.status === "no-candidate" ? "no-candidate" : candidate.status,
        relation: "",
        sequence: "",
        path: candidate.path,
        reason: candidate.reason
      });
      continue;
    }
    const concept = state.concepts.get(candidate.sumoId);
    const resolution = {
      status: "resolved",
      path: candidate.path,
      relation: candidate.relation,
      sequence: candidate.sequence,
      reason: candidate.reason
    };
    let record;
    try {
      record = buildSumoConceptLinkRecord({ concept, evidence, resolution });
    } catch (error) {
      decisions.push({
        id: `decision:${candidate.sumoId}`,
        sumoId: candidate.sumoId,
        status: "uncertain",
        relation: "",
        sequence: "",
        path: candidate.path,
        reason: text(error?.message)
      });
      continue;
    }
    accepted.push(record);
    decisions.push({
      id: `decision:${candidate.sumoId}`,
      sumoId: candidate.sumoId,
      status: "accepted",
      relation: record.relation,
      sequence: record.pyashSequence.join(" "),
      path: record.evidence.path,
      reason: record.evidence.reason
    });
  }
  await appendSumoConceptRowsPyaFile(decisionPath, SUMO_CONCEPT_DECISION_NAME, SUMO_CONCEPT_DECISION_FORMAT, decisions, {
    "prompt-revision": context.config.promptRevision,
    "model": context.config.model
  });
  const promotion = await promoteSumoConceptLinks(accepted);
  const counts = decisions.reduce((totals, decision) => {
    totals[decision.status] = (totals[decision.status] ?? 0) + 1;
    return totals;
  }, {});
  return {
    "decision-path": decisionPath,
    "promoted-path": promotion.path,
    "accepted-count": accepted.length,
    "promoted-count": promotion.count,
    "rejected-count": counts.rejected ?? 0,
    "uncertain-count": counts.uncertain ?? 0,
    "no-candidate-count": counts["no-candidate"] ?? 0,
    "failed-count": counts.failed ?? 0
  };
}

async function runStage(sentence, context) {
  const stage = text(sentence?.su?.name);
  const output = outputHandle(sentence);
  let result;
  if (stage === "select concepts") {
    result = await selectConcepts({ context, dependencies: context.dependencies });
  } else if (stage === "resolve concept mapping") {
    result = await resolveCandidates({ context, dependencies: context.dependencies });
  } else if (stage === "verify concept mapping") {
    result = await verifyLinks({ context, dependencies: context.dependencies });
  } else {
    throw invalid("unknown SUMO concept refinery stage", { stage });
  }
  const fact = mapFact(output, result);
  doRemember(fact);
  return fact;
}

async function ensureRefinery({ interpretFn = interpret } = {}) {
  const registered = getRefinery(SUMO_CONCEPT_REFINERY_NAME);
  if (registered) return registered;
  const sentences = buildProgram(await readFile(SUMO_CONCEPT_CONFIG_URL, "utf8")).sentences;
  for (const sentence of sentences) await interpretFn(sentence);
  const refinery = getRefinery(SUMO_CONCEPT_REFINERY_NAME);
  if (!refinery) throw invalid("SUMO concept refinery definition was not registered");
  return refinery;
}

function configureMind(model) {
  const backend = text(resolveConfigText("mind backend", { rememberFn: remember }) || "ollama command mind");
  const host = text((/ollama/iu.test(backend)
    ? resolveConfigText("ollama host", { rememberFn: remember })
    : resolveConfigText("ai host", { rememberFn: remember }) || resolveConfigText("ollama host", { rememberFn: remember })) || "");
  const housekeeper = text(resolveConfigText("gpu housekeeper url", { rememberFn: remember }) || "");
  const selectedHousekeeper = text(process.env.PYA_GPU_HOUSEKEEPER_URL || housekeeper);
  if (!model || !host || !selectedHousekeeper) {
    throw invalid("SUMO concept refinery requires a configured mind model, host, and GPU Housekeeper URL");
  }
  process.env.PYA_GPU_HOUSEKEEPER_URL = selectedHousekeeper;
  process.env.PYA_GPU_MANAGER_REQUIRED = "true";
  doRemember({
    mood: "ya",
    su: { name: "mind" },
    be: "mind",
    as: { name: model },
    fromstate: { text: backend },
    from: { text: host }
  });
}

export async function runSumoConceptRefinery({
  artifactRoot = join(REPOSITORY_ROOT, "artifacts"),
  dependencies = {},
  configuration = {},
  sweepState = {},
  checkpointEnabled = true,
  runId = "",
  interpretFn = interpret,
  parseFn = parse,
  onEvoke,
  onCheckpoint,
  onStage,
  initialize = true,
  repositoryRoot = REPOSITORY_ROOT
} = {}) {
  if (process.env.PYA_MIND_RESPONSE) throw invalid("SUMO concept refinery requires PYA_MIND_RESPONSE to be unset");
  const config = parseSumoConceptConfig(await readFile(SUMO_CONCEPT_CONFIG_URL, "utf8"));
  config.maximumConcepts = Math.max(1, Math.trunc(Number(configuration.maximumConcepts) || config.maximumConcepts));
  if (Array.isArray(configuration.conceptIds)) {
    config.conceptIds = configuration.conceptIds.map((value) => text(value).trim()).filter(Boolean);
  }
  const previousHousekeeper = process.env.PYA_GPU_HOUSEKEEPER_URL;
  const previousManagerRequired = process.env.PYA_GPU_MANAGER_REQUIRED;
  try {
    if (initialize) {
      forget();
      clearSignatureHandlers();
      for (const signature of builtInSignatures) registerSignatureHandler(signature);
      if (typeof dependencies.initializeRuntime === "function") await dependencies.initializeRuntime();
      else await (await import("../../../command/run_pya_helpers.mjs")).loadDefaultConfig({ cwd: repositoryRoot, interpretFn, entryPath: repositoryRoot });
      configureMind(config.model);
    }
    const state = sweepState.sumoState ?? (sweepState.sumoState = await loadSumoConceptState({ dependencies, repositoryRoot }));
    const stableRunId = runId || sumoConceptRunId({ sourceHash: state.sourceHash, promptRevision: config.promptRevision });
    const artifactDirectory = join(resolve(artifactRoot), stableRunId);
    await mkdir(artifactDirectory, { recursive: true });
    const context = {
      config,
      dependencies,
      repositoryRoot,
      artifactDirectory,
      sumoState: state,
      interpretFn,
      parseFn
    };
    await ensureRefinery({ interpretFn });
    const output = await runRefinery({
      name: SUMO_CONCEPT_REFINERY_NAME,
      interpret: (sentence) => runStage(sentence, context),
      runId: stableRunId,
      checkpointIndex: new Map(),
      checkpointEnabled,
      onEvoke,
      onCheckpoint,
      onResult: onStage
    });
    if (output?.mood === "ya" && output?.be === "error") throw new Error(output.ob?.text || "SUMO concept refinery failed");
    const result = mapValue("concept mapping results");
    return {
      runId: stableRunId,
      artifactDirectory,
      selectedConceptCount: Number(mapValue("concept mapping")["selected-concept-count"] ?? 0),
      remainingConceptCount: mapValue("concept mapping")["remaining-concept-count"] ?? 0,
      result
    };
  } finally {
    if (initialize) forget();
    if (previousHousekeeper === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = previousHousekeeper;
    if (previousManagerRequired === undefined) delete process.env.PYA_GPU_MANAGER_REQUIRED;
    else process.env.PYA_GPU_MANAGER_REQUIRED = previousManagerRequired;
  }
}
