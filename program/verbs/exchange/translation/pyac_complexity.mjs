import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { buildProgram } from "../../../program.mjs";

export const PYAC_COMPLEXITY_LAYERS_FORMAT = "pyac-complexity-layers-v1";
export const PYAC_COMPLEXITY_LAYERS_NAME = "translation_pyac_complexity_layers";

const EXPECTED_LAYERS = Object.freeze([16, 19, 24, 28, 32]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-pyac-complexity-layers";
  error.details = details;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sourceHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePayload(sentence, index) {
  if (typeof sentence?.ob?.text !== "string") {
    throw invalid("complexity layer requires a JSON text payload", { index });
  }
  try {
    return JSON.parse(sentence.ob.text);
  } catch (error) {
    throw invalid("complexity layer JSON payload is malformed", { index, cause: error.message });
  }
}

function normalizeLayer(payload, key, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("complexity layer payload must be an object", { index });
  }
  const layer = Number(payload.layer);
  if (!Number.isInteger(layer) || layer < 1 || String(layer) !== String(key).replace(/^layer:/u, "")) {
    throw invalid("complexity layer key and payload disagree", { index, key, layer: payload.layer });
  }
  if (!Number.isInteger(payload.glyphCount) || payload.glyphCount !== layer) {
    throw invalid("complexity layer requires a matching glyph count", { index, layer });
  }
  for (const field of ["wordList", "source", "wordGlyphs", "features", "sourceHash"]) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      throw invalid(`complexity layer requires ${field}`, { index, layer });
    }
  }
  if (typeof payload.adds !== "string") {
    throw invalid("complexity layer requires adds", { index, layer });
  }
  return {
    layer,
    glyphCount: payload.glyphCount,
    wordList: payload.wordList,
    source: payload.source,
    wordGlyphs: payload.wordGlyphs,
    features: payload.features,
    adds: payload.adds,
    sourceHash: payload.sourceHash
  };
}

export function parsePyacComplexityLayers(source) {
  if (typeof source !== "string") throw invalid("complexity layer source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === PYAC_COMPLEXITY_LAYERS_NAME
  ));
  if (!header) throw invalid("complexity layer source has no canonical map header");

  const formatSentence = sentences.find((sentence) => sentence?.su?.text === "format");
  if (formatSentence?.ob?.text !== PYAC_COMPLEXITY_LAYERS_FORMAT) {
    throw invalid("complexity layer source has an unsupported format");
  }

  const layers = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    const key = sentence?.su?.text;
    if (typeof key !== "string" || !/^layer:\d+$/u.test(key)) continue;
    if (seen.has(key)) throw invalid("complexity layer is duplicated", { index, key });
    seen.add(key);
    layers.push(normalizeLayer(parsePayload(sentence, index), key, index));
  }

  layers.sort((left, right) => left.layer - right.layer);
  if (layers.length !== EXPECTED_LAYERS.length ||
      layers.some((layer, index) => layer.layer !== EXPECTED_LAYERS[index])) {
    throw invalid("complexity layer source must define 16, 19, 24, 28, and 32 layers", {
      layers: layers.map((layer) => layer.layer)
    });
  }
  return {
    format: PYAC_COMPLEXITY_LAYERS_FORMAT,
    name: PYAC_COMPLEXITY_LAYERS_NAME,
    layers
  };
}

export async function loadPyacComplexityLayers({
  url = new URL("./pyac_complexity_layers.pya", import.meta.url)
} = {}) {
  return parsePyacComplexityLayers(await fs.readFile(url, "utf8"));
}

function layerTextsByNumber(wordLists) {
  if (!wordLists || typeof wordLists !== "object" || Array.isArray(wordLists)) {
    throw invalid("complexity word lists must be an object");
  }
  return wordLists;
}

export function buildPyacWordLayerIndex({ manifest, wordLists } = {}) {
  if (!manifest || manifest.format !== PYAC_COMPLEXITY_LAYERS_FORMAT || !Array.isArray(manifest.layers)) {
    throw invalid("complexity word index requires a parsed layer manifest");
  }
  const texts = layerTextsByNumber(wordLists);
  const byWord = new Map();
  const sourceHashes = {};
  for (const layer of manifest.layers) {
    const value = texts[layer.layer] ?? texts[String(layer.layer)];
    if (typeof value !== "string") {
      throw invalid("complexity word list is missing", { layer: layer.layer });
    }
    sourceHashes[layer.layer] = sourceHash(value);
    const words = value
      .split(/\r?\n/u)
      .map((word) => word.trim())
      .filter(Boolean);
    for (const word of words) {
      if (!byWord.has(word)) byWord.set(word, layer.layer);
    }
  }
  return { manifest, byWord, sourceHashes };
}

export async function loadPyacWordLayerIndex({
  manifest,
  directory,
  verifySourceHashes = true
} = {}) {
  if (typeof directory !== "string" || !directory) {
    throw invalid("complexity word index requires a source directory");
  }
  const resolvedManifest = manifest ?? await loadPyacComplexityLayers();
  const wordLists = Object.fromEntries(
    await Promise.all(resolvedManifest.layers.map(async (layer) => [
      layer.layer,
      await fs.readFile(resolve(directory, layer.wordList), "utf8")
    ]))
  );
  const index = buildPyacWordLayerIndex({ manifest: resolvedManifest, wordLists });
  if (verifySourceHashes) {
    for (const layer of resolvedManifest.layers) {
      if (index.sourceHashes[layer.layer] !== layer.sourceHash) {
        throw invalid("complexity word list source hash does not match manifest", {
          layer: layer.layer,
          expected: layer.sourceHash,
          actual: index.sourceHashes[layer.layer]
        });
      }
    }
  }
  return index;
}

export function classifyPyacWord(word, index) {
  if (typeof word !== "string" || !word || !index?.byWord) return null;
  return index.byWord.get(word) ?? null;
}

function candidateWithLayers(candidate, index) {
  if (!candidate || !Array.isArray(candidate.pyashSequence) || candidate.pyashSequence.length === 0) {
    return null;
  }
  const componentLayers = index?.byWord
    ? candidate.pyashSequence.map((word) => classifyPyacWord(word, index))
    : Array.isArray(candidate.componentLayers)
      ? [...candidate.componentLayers]
      : [];
  if (componentLayers.length !== candidate.pyashSequence.length || componentLayers.some((layer) => !Number.isInteger(layer))) {
    return null;
  }
  return {
    ...candidate,
    componentLayers,
    maxLayer: Math.max(...componentLayers)
  };
}

export function rankPyacCompoundCandidates(candidates, index) {
  if (!Array.isArray(candidates)) throw invalid("compound candidates must be an array");
  return candidates
    .map((candidate) => candidateWithLayers(candidate, index))
    .filter(Boolean)
    .sort((left, right) => (
      left.maxLayer - right.maxLayer ||
      left.componentLayers.reduce((sum, layer) => sum + layer, 0) - right.componentLayers.reduce((sum, layer) => sum + layer, 0) ||
      left.pyashSequence.length - right.pyashSequence.length ||
      stableJson(left).localeCompare(stableJson(right))
    ));
}

export function choosePyacCompoundCandidate(candidates, index) {
  return rankPyacCompoundCandidates(candidates, index)[0] ?? null;
}
