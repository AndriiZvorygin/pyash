import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import pyashWords from "../pyashWords.json" with { type: "json" };
import {
  filterDeprecatedEnglishAtoms,
  loadEnglishLemmaCatalog
} from "./english_lemmas.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "./pyac_complexity.mjs";
import {
  CURATED_COMPOUND_CATALOG_URL,
  prepareCuratedCompoundCatalogUpdate
} from "./curated_compound_catalog.mjs";
import {
  ENGLISH_WORDNET_BRIDGE_CONFIG_URL,
  parseEnglishWordNetBridgeCatalog,
  renderEnglishWordNetBridgeCatalog
} from "./english_wordnet_bridges.mjs";

export const VOCABULARY_ENTRY_REVIEW_NAME = "translation_vocabulary_entry_reviews";
export const VOCABULARY_ENTRY_REVIEW_URL = new URL("./vocabulary_entry_reviews.pya", import.meta.url);

const REVIEW_FORMAT = "vocabulary-entry-review-v1";
const REVIEW_STATUSES = new Set([
  "review-needed",
  "accepted-curated",
  "rejected-curated",
  "deferred-curated"
]);
const MODEL_STATUSES = new Set([
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm",
  "not-selected-llm",
  "rejected-deterministic",
  "rejected-llm",
  "uncertain-llm"
]);
const INPUT_FIELDS = new Set([
  "target",
  "gloss",
  "pyash",
  "sense-id",
  "review-status",
  "model-status",
  "evidence"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-vocabulary-entry-review";
  error.details = details;
  return error;
}

function normalized(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ")
    : "";
}

function textAt(sentence, role) {
  return typeof sentence?.[role]?.text === "string" ? sentence[role].text.trim() : "";
}

function reviewIdFor({ target, senseId, pyashSequence }) {
  const identity = [senseId, target, pyashSequence.join(" ")].join("\u0000");
  return `vocabulary-review-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function parseInputRequest(source) {
  if (typeof source !== "string") throw invalid("vocabulary review input must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === "vocabulary entry review");
  if (!header) throw invalid("input must define `vocabulary entry review` as a map");

  const fields = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence?.su?.text !== "string") continue;
    const key = sentence.su.text.trim().toLowerCase();
    if (!INPUT_FIELDS.has(key)) throw invalid("input contains an unsupported vocabulary review field", { index, field: key });
    if (fields.has(key)) throw invalid("input repeats a vocabulary review field", { index, field: key });
    const value = textAt(sentence, "ob");
    if (!value) throw invalid("vocabulary review fields must contain non-empty text", { index, field: key });
    fields.set(key, value);
  }

  for (const key of ["target", "gloss", "pyash", "sense-id", "review-status", "evidence"]) {
    if (!fields.has(key)) throw invalid(`input is missing required field: ${key}`);
  }

  const target = normalized(fields.get("target"));
  const gloss = fields.get("gloss").normalize("NFC").trim();
  const pyashSequence = fields.get("pyash").split(/\s+/u).filter(Boolean);
  const senseId = fields.get("sense-id").toLowerCase();
  const senseMatch = senseId.match(/^([anrvs]):[0-9]{8}-([anrvs])$/u);
  const reviewStatus = fields.get("review-status").toLowerCase();
  const modelStatus = (fields.get("model-status") ?? "").toLowerCase();
  if (!target || !gloss || pyashSequence.length === 0) throw invalid("target, gloss, and Pyash form must be non-empty");
  if (!senseMatch || senseMatch[1] !== senseMatch[2]) {
    throw invalid("sense-id must be a POS-qualified WordNet synset such as n:07558676-n", { senseId });
  }
  if (!REVIEW_STATUSES.has(reviewStatus)) {
    throw invalid("review-status is unsupported", { reviewStatus, supported: [...REVIEW_STATUSES] });
  }
  if (modelStatus && !MODEL_STATUSES.has(modelStatus)) {
    throw invalid("model-status is unsupported", { modelStatus, supported: [...MODEL_STATUSES] });
  }
  return {
    target,
    gloss,
    pyashSequence,
    senseId,
    targetPartOfSpeech: senseMatch[2],
    reviewStatus,
    ...(modelStatus ? { modelStatus } : {}),
    evidence: fields.get("evidence").normalize("NFC").trim()
  };
}

function resolveAtoms(pyashSequence, atomicEntries) {
  return pyashSequence.map((word) => {
    const matches = atomicEntries.filter((entry) => entry?.pya?.trim() === word);
    const english = new Set(matches
      .filter((entry) => typeof entry?.en === "string" && entry.en.trim() && !entry.en.trim().endsWith("_"))
      .map((entry) => normalized(entry.en)));
    if (english.size === 0) throw invalid(`Pyash component is not an existing atom: ${word}`, { word });
    if (english.size > 1) throw invalid(`Pyash component maps to multiple English atoms: ${word}`, { word, english: [...english] });
    const canonicalEnglish = [...english][0];
    return matches.find((entry) => normalized(entry.en) === canonicalEnglish);
  });
}

function buildReviewRecord(request, atomicEntries) {
  const atoms = resolveAtoms(request.pyashSequence, atomicEntries);
  const coverageTarget = request.pyashSequence.length === 1
    ? normalized(atoms[0].en)
    : request.target;
  if (request.pyashSequence.length > 1 && atomicEntries.some((entry) => normalized(entry?.en) === request.target)) {
    throw invalid(`compound target is already an atom: ${request.target}`, { target: request.target });
  }
  const reviewId = reviewIdFor(request);
  return {
    reviewId,
    ...request,
    coverageTarget,
    ...(request.modelStatus ? { modelStatus: request.modelStatus } : {}),
    bridgeManaged: false
  };
}

function emptyReviewSource() {
  return [
    `su name ${VOCABULARY_ENTRY_REVIEW_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(REVIEW_FORMAT)} ya`,
    "prah",
    ""
  ].join("\n");
}

/**
 * Parse and validate a review catalog.
 *
 * Exported so a quiz can check the catalog that ships in the tree. The shipped
 * file and the writer share these rules, and 12 rows once carried a review
 * status in the `modelStatus` slot — a catalog its own tool refused to open, but
 * which the build happily consumed because nothing validated the file itself.
 */
export function parseReviewCatalog(source) {
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === VOCABULARY_ENTRY_REVIEW_NAME);
  if (!header) throw invalid("review catalog has no canonical map header");
  const format = sentences.find((sentence) => sentence?.mood === "ya" && sentence?.su?.text === "format")?.ob?.text;
  if (format !== REVIEW_FORMAT) throw invalid("review catalog format is unsupported", { format });

  const rows = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence?.su?.text !== "string" || sentence.su.text === "format") continue;
    if (typeof sentence?.ob?.text !== "string") throw invalid("review catalog row requires JSON text", { index });
    let row;
    try {
      row = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("review catalog row has malformed JSON", { index, cause: error.message });
    }
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.reviewId !== "string" || sentence.su.text !== row.reviewId
      || !row.target || !row.coverageTarget || !row.gloss || !row.senseId
      || !Array.isArray(row.pyashSequence) || row.pyashSequence.length === 0
      || !REVIEW_STATUSES.has(row.reviewStatus)
      || typeof row.evidence !== "string" || !row.evidence
      || typeof row.bridgeManaged !== "boolean"
      || (row.modelStatus !== undefined && !MODEL_STATUSES.has(row.modelStatus))) {
      throw invalid("review catalog row has invalid fields or identity", { index, rowKey: sentence.su.text });
    }
    if (seen.has(row.reviewId)) throw invalid("review catalog entry is duplicated", { reviewId: row.reviewId });
    seen.add(row.reviewId);
    rows.push(row);
  }
  return rows;
}

function renderReviewCatalog(rows) {
  const ordered = [...rows].sort((left, right) => left.reviewId.localeCompare(right.reviewId));
  return [
    `su name ${VOCABULARY_ENTRY_REVIEW_NAME} be map def`,
    `su text "format" ob text ${JSON.stringify(REVIEW_FORMAT)} ya`,
    ...ordered.map((row) => `su text ${JSON.stringify(row.reviewId)} ob text ${JSON.stringify(JSON.stringify(row))} ya`),
    "prah",
    ""
  ].join("\n");
}

function parsedLineKey(line) {
  try {
    const sentence = buildProgram(line).sentences[0];
    return sentence?.mood === "ya" ? textAt(sentence, "su") : "";
  } catch {
    return "";
  }
}

function prepareBridgeUpdate(source, review, previousReview) {
  const catalog = parseEnglishWordNetBridgeCatalog(source);
  const existing = catalog.entries.find((entry) => entry.source === review.senseId);
  const marker = `vocabulary-entry-review:${review.reviewId}`;
  if (review.reviewStatus === "accepted-curated") {
    if (existing) {
      if (existing.target !== review.coverageTarget || existing.targetPartOfSpeech !== review.targetPartOfSpeech) {
        throw invalid("WordNet sense already links to a different Pyash target", {
          senseId: review.senseId,
          existingTarget: existing.target,
          requestedTarget: review.coverageTarget
        });
      }
      if (!existing.gloss || !Array.isArray(existing.lemmas) || existing.lemmas.length === 0) {
        const metadataLines = [
          ...(!existing.gloss ? [`su text ${JSON.stringify(`sense-gloss:${review.senseId}`)} ob text ${JSON.stringify(review.gloss)} ya`] : []),
          ...(!Array.isArray(existing.lemmas) || existing.lemmas.length === 0
            ? [`su text ${JSON.stringify(`sense-lemma:${review.senseId}:1`)} ob text ${JSON.stringify(review.target)} ya`]
            : [])
        ];
        const lines = source.split(/\r?\n/u);
        const prahIndex = [...lines].map((line, index) => [line, index])
          .reverse()
          .find(([line]) => line.trim() === "prah")?.[1];
        if (prahIndex === undefined) throw invalid("WordNet bridge catalog has no trailing prah");
        lines.splice(prahIndex, 0, ...metadataLines);
        const updatedSource = lines.join("\n").replace(/\n*$/u, "\n");
        parseEnglishWordNetBridgeCatalog(updatedSource);
        return {
          source: updatedSource,
          bridgeManaged: existing.evidence.startsWith(`${marker};`),
          status: "metadata-completed"
        };
      }
      return {
        source,
        bridgeManaged: existing.evidence.startsWith(`${marker};`),
        status: "already-linked"
      };
    }

    const entry = {
      source: review.senseId,
      target: review.coverageTarget,
      targetPartOfSpeech: review.targetPartOfSpeech,
      certainty: "contextual",
      evidence: `${marker}; ${review.evidence}`,
      gloss: review.gloss,
      lemmas: [review.target]
    };
    const rendered = renderEnglishWordNetBridgeCatalog({
      source: catalog.source,
      sourceHash: catalog.sourceHash,
      mode: catalog.mode,
      entries: [entry]
    });
    const snippetLines = rendered.split(/\r?\n/u)
      .filter((line) => {
        const key = parsedLineKey(line);
        return key === review.senseId
          || key === `sense-gloss:${review.senseId}`
          || key.startsWith(`sense-lemma:${review.senseId}:`);
      });
    if (snippetLines.length !== 3) throw invalid("could not render the WordNet bridge row and its sense metadata", { senseId: review.senseId });
    const lines = source.split(/\r?\n/u);
    const prahIndex = [...lines].map((line, index) => [line, index])
      .reverse()
      .find(([line]) => line.trim() === "prah")?.[1];
    if (prahIndex === undefined) throw invalid("WordNet bridge catalog has no trailing prah");
    lines.splice(prahIndex, 0, ...snippetLines);
    const updatedSource = lines.join("\n").replace(/\n*$/u, "\n");
    parseEnglishWordNetBridgeCatalog(updatedSource);
    return { source: updatedSource, bridgeManaged: true, status: "linked" };
  }

  if (!previousReview?.bridgeManaged || !existing || !existing.evidence.startsWith(`${marker};`)) {
    return { source, bridgeManaged: false, status: "not-linked" };
  }
  const lines = source.split(/\r?\n/u).filter((line) => {
    const key = parsedLineKey(line);
    return key !== review.senseId
      && key !== `sense-gloss:${review.senseId}`
      && !key.startsWith(`sense-lemma:${review.senseId}:`);
  });
  const updatedSource = lines.join("\n").replace(/\n*$/u, "\n");
  parseEnglishWordNetBridgeCatalog(updatedSource);
  return { source: updatedSource, bridgeManaged: false, status: "unlinked" };
}

async function replaceFilesAtomically(files) {
  const nonce = `${process.pid}.${randomUUID()}`;
  const staged = [];
  let committed = false;
  try {
    for (const { filename, contents } of files) {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${nonce}.tmp`;
      const backup = `${filename}.${nonce}.bak`;
      const item = { filename, temporary, backup, hadOriginal: false, installed: false };
      staged.push(item);
      await fs.writeFile(temporary, contents, "utf8");
    }
    for (const item of staged) {
      try {
        await fs.rename(item.filename, item.backup);
        item.hadOriginal = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await fs.rename(item.temporary, item.filename);
      item.installed = true;
    }
    committed = true;
  } catch (error) {
    const rollbackFailures = [];
    for (const item of [...staged].reverse()) {
      if (item.installed) {
        try {
          await fs.rm(item.filename, { force: true });
        } catch (rollbackError) {
          rollbackFailures.push({ path: item.filename, message: rollbackError.message });
        }
      }
      if (item.hadOriginal) {
        try {
          await fs.rename(item.backup, item.filename);
          item.restored = true;
        } catch (rollbackError) {
          rollbackFailures.push({ path: item.backup, message: rollbackError.message });
        }
      }
    }
    if (rollbackFailures.length > 0) error.rollbackFailures = rollbackFailures;
    throw error;
  } finally {
    await Promise.all(staged.map((item) => fs.rm(item.temporary, { force: true }).catch(() => {})));
    await Promise.all(staged
      .filter((item) => committed || !item.hadOriginal || item.restored)
      .map((item) => fs.rm(item.backup, { force: true }).catch(() => {})));
  }
}

export async function reviewVocabularyEntry(source, {
  reviewCatalogUrl = VOCABULARY_ENTRY_REVIEW_URL,
  compoundCatalogUrl = CURATED_COMPOUND_CATALOG_URL,
  bridgeCatalogUrl = ENGLISH_WORDNET_BRIDGE_CONFIG_URL
} = {}) {
  const request = parseInputRequest(source);
  const lemmaCatalog = await loadEnglishLemmaCatalog();
  const atomicEntries = filterDeprecatedEnglishAtoms(pyashWords, lemmaCatalog.entries);
  const review = buildReviewRecord(request, atomicEntries);
  const reviewPath = reviewCatalogUrl instanceof URL ? fileURLToPath(reviewCatalogUrl) : String(reviewCatalogUrl);
  const compoundPath = compoundCatalogUrl instanceof URL ? fileURLToPath(compoundCatalogUrl) : String(compoundCatalogUrl);
  const bridgePath = bridgeCatalogUrl instanceof URL ? fileURLToPath(bridgeCatalogUrl) : String(bridgeCatalogUrl);

  let reviewSource;
  try {
    reviewSource = await fs.readFile(reviewPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    reviewSource = emptyReviewSource();
  }
  const currentReviews = parseReviewCatalog(reviewSource);
  const previousReview = currentReviews.find((entry) => entry.reviewId === review.reviewId);
  if (!review.modelStatus && previousReview?.modelStatus) review.modelStatus = previousReview.modelStatus;
  const currentBridgeSource = await fs.readFile(bridgePath, "utf8");
  const bridgeUpdate = prepareBridgeUpdate(currentBridgeSource, review, previousReview);
  review.bridgeManaged = bridgeUpdate.bridgeManaged;

  const files = [{ filename: reviewPath, contents: renderReviewCatalog([
    ...currentReviews.filter((entry) => entry.reviewId !== review.reviewId),
    review
  ]) }];

  if (review.reviewStatus === "accepted-curated" && review.pyashSequence.length > 1) {
    const modulePath = path.dirname(fileURLToPath(import.meta.url));
    const repositoryRoot = path.resolve(modulePath, "../../..");
    const manifest = await loadPyacComplexityLayers();
    const layerIndex = await loadPyacWordLayerIndex({
      manifest,
      directory: path.resolve(repositoryRoot, "..", "pyachso2n")
    });
    const compoundSource = await fs.readFile(compoundPath, "utf8");
    const update = prepareCuratedCompoundCatalogUpdate({
      source: compoundSource,
      surface: review.target,
      gloss: review.gloss,
      components: resolveAtoms(review.pyashSequence, atomicEntries).map((atom) => atom.en),
      atomicEntries,
      layerIndex,
      evidence: review.evidence,
      provenance: `user-curated vocabulary entry review ${review.reviewId}`
    });
    if (update.source !== compoundSource) files.push({ filename: compoundPath, contents: update.source });
  }

  if (bridgeUpdate.source !== currentBridgeSource) files.push({ filename: bridgePath, contents: bridgeUpdate.source });
  await replaceFilesAtomically(files);
  return {
    reviewId: review.reviewId,
    target: review.target,
    coverageTarget: review.coverageTarget,
    senseId: review.senseId,
    pyashSequence: review.pyashSequence,
    reviewStatus: review.reviewStatus,
    modelStatus: review.modelStatus ?? "",
    linkStatus: bridgeUpdate.status
  };
}
