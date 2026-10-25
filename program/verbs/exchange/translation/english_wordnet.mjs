import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../../program.mjs";

export const ENGLISH_WORDNET_FORMAT = "english-wordnet-core-v1";
export const ENGLISH_WORDNET_NAME = "translation_english_wordnet";
export const ENGLISH_WORDNET_DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../",
  "..",
  "pyachso2n",
  "wordnet-core.txt"
);
export const ENGLISH_WORDNET_CONFIG_URL = new URL("./english_wordnet.pya", import.meta.url);

const WORDNET_POS = new Set(["a", "n", "r", "v", "s"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet";
  error.details = details;
  return error;
}

function normalize(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ")
    : "";
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseLine(line, lineNumber) {
  const value = String(line).trim();
  if (!value || value.startsWith("#")) return null;
  const relationMatch = value.match(/^r\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\](?:\s+(.*))?$/u);
  if (relationMatch) {
    const [, source, target, relation, rawEvidence = ""] = relationMatch;
    if (!source.trim() || !target.trim() || !relation.trim()) {
      throw invalid("WordNet relation has an invalid source, target, or type", { lineNumber, line });
    }
    return {
      kind: "relation",
      id: `relation:${source.trim()}:${target.trim()}:${relation.trim()}:${hash(value).slice(0, 12)}`,
      source: source.trim(),
      target: target.trim(),
      relation: relation.trim(),
      evidence: rawEvidence.trim()
    };
  }
  const match = value.match(/^([anrvs])\s+\[([^\]]+)\]\s+\[([^\]]+)\](?:\s+(.*))?$/u);
  if (!match) {
    throw invalid("WordNet line is malformed", { lineNumber, line });
  }
  const [, pos, synset, rawLemma, rawGloss = ""] = match;
  if (!WORDNET_POS.has(pos) || !synset.trim() || !rawLemma.trim()) {
    throw invalid("WordNet row has an invalid part of speech, synset, or lemma", { lineNumber, line });
  }
  return {
    id: `${pos}:${synset}:${normalize(rawLemma)}:${hash(rawGloss.trim()).slice(0, 12)}`,
    pos,
    synset: synset.trim(),
    senseKey: synset.trim(),
    lemma: normalize(rawLemma),
    gloss: rawGloss.trim()
  };
}

export function parseEnglishWordNetText(source, { strict = true } = {}) {
  if (typeof source !== "string") throw invalid("WordNet source must be text");
  const rows = [];
  const relations = [];
  const skippedLines = [];
  const seen = new Set();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    try {
      const row = parseLine(line, index + 1);
      if (!row) continue;
      if (seen.has(row.id)) throw invalid("WordNet row is duplicated", { lineNumber: index + 1, id: row.id });
      seen.add(row.id);
      if (row.kind === "relation") relations.push(row);
      else rows.push(row);
    } catch (error) {
      if (strict) throw error;
      skippedLines.push({ lineNumber: index + 1, line: String(line), reason: error.message });
    }
  }
  return {
    format: ENGLISH_WORDNET_FORMAT,
    rows,
    relations,
    skippedLines,
    sourceHash: hash(source),
    sourceRows: rows.length + relations.length + skippedLines.length
  };
}

function lookupVariants(value) {
  const normalized = normalize(value);
  if (!normalized) return [];
  return [...new Set([normalized, normalized.replace(/ /gu, "_"), normalized.replace(/ /gu, "-")])];
}

function relationKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function buildEnglishWordNetIndex({ rows = [], relations = [] } = {}) {
  const byLemma = new Map();
  const bySynset = new Map();
  const relationGraph = new Map();
  for (const row of rows) {
    if (!row?.lemma || !row?.synset || !WORDNET_POS.has(row.pos)) continue;
    const group = bySynset.get(`${row.pos}:${row.synset}`) ?? [];
    group.push({ ...row });
    bySynset.set(`${row.pos}:${row.synset}`, group);
    for (const variant of lookupVariants(row.lemma)) {
      const matches = byLemma.get(variant) ?? [];
      matches.push({ ...row });
      byLemma.set(variant, matches);
    }
  }
  for (const relation of relations) {
    const source = relationKey(relation?.source);
    const target = relationKey(relation?.target);
    if (!source || !target) continue;
    const sourceEdges = relationGraph.get(source) ?? [];
    sourceEdges.push({ target, relation: relation.relation, evidence: relation.evidence ?? "" });
    relationGraph.set(source, sourceEdges);
    const targetEdges = relationGraph.get(target) ?? [];
    targetEdges.push({ target: source, relation: relation.relation, evidence: relation.evidence ?? "" });
    relationGraph.set(target, targetEdges);
  }
  function relatedness(sourceValue, targetValue, maxDepth = 4) {
    const source = relationKey(sourceValue);
    const target = relationKey(targetValue);
    if (!source || !target) return 0;
    if (source === target) return 1;
    const queue = [{ key: source, depth: 0 }];
    const visited = new Set([source]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;
      for (const edge of relationGraph.get(current.key) ?? []) {
        if (edge.target === target) return 1 / (current.depth + 2);
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        queue.push({ key: edge.target, depth: current.depth + 1 });
      }
    }
    return 0;
  }
  return {
    rows: rows.map((row) => ({ ...row })),
    relations: relations.map((relation) => ({ ...relation })),
    byLemma,
    bySynset,
    relationGraph,
    relatedness,
    lookup(surface) {
      return lookupVariants(surface)
        .flatMap((variant) => byLemma.get(variant) ?? [])
        .filter((row, index, matches) => matches.findIndex((candidate) => candidate.id === row.id) === index);
    },
    senses(surface) {
      const rowsForWord = this.lookup(surface);
      return rowsForWord.map((row) => ({
        pos: row.pos,
        synset: row.synset,
        gloss: row.gloss,
        lemmas: (bySynset.get(`${row.pos}:${row.synset}`) ?? []).map((candidate) => candidate.lemma)
      }));
    }
  };
}

export function parseEnglishWordNetConfig(source) {
  if (typeof source !== "string") throw invalid("WordNet configuration must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_NAME
  ));
  if (!header) throw invalid("WordNet configuration has no canonical map header");
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") metadata[sentence.su.text] = sentence.ob.text;
  }
  if (metadata.format !== ENGLISH_WORDNET_FORMAT) {
    throw invalid("WordNet configuration has an unsupported format", { format: metadata.format });
  }
  if (!metadata.source) throw invalid("WordNet configuration requires a source path");
  return {
    format: metadata.format,
    source: metadata.source,
    sourceHash: metadata["source-hash"] ?? "",
    mode: metadata.mode ?? "read-only semantic evidence"
  };
}

export async function loadEnglishWordNet({ path, strict = true, configUrl = ENGLISH_WORDNET_CONFIG_URL } = {}) {
  const configuration = path
    ? null
    : parseEnglishWordNetConfig(await readFile(configUrl, "utf8"));
  const sourcePath = path ?? configuration?.source ?? ENGLISH_WORDNET_DEFAULT_PATH;
  const source = await readFile(sourcePath, "utf8");
  const parsed = parseEnglishWordNetText(source, { strict });
  if (configuration?.sourceHash && configuration.sourceHash !== parsed.sourceHash) {
    throw invalid("WordNet source hash does not match configuration", {
      expected: configuration.sourceHash,
      actual: parsed.sourceHash
    });
  }
  return {
    ...parsed,
    path: resolve(sourcePath),
    configuration,
    index: buildEnglishWordNetIndex(parsed)
  };
}

