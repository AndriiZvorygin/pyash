import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import { buildEnglishWordNetBridgeIndex } from "./english_wordnet_bridges.mjs";

export const ENGLISH_WORDNET_FORMAT = "english-wordnet-core-v1";
export const OPEN_ENGLISH_WORDNET_FORMAT = "open-english-wordnet-2025-json-v1";
export const ENGLISH_WORDNET_NAME = "translation_english_wordnet";
export const ENGLISH_WORDNET_DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
  "..",
  "pyachso2n",
  "wordnet-core.txt"
);
export const ENGLISH_WORDNET_CONFIG_URL = new URL("./english_wordnet.pya", import.meta.url);

const WORDNET_POS = new Set(["a", "n", "r", "v", "s"]);
const OPEN_SYNSET_FILE = /^(adj|adv|noun|verb)\..+\.json$/u;
const OPEN_RELATION_FIELDS = new Set([
  "also",
  "attribute",
  "causes",
  "domain_region",
  "domain_topic",
  "entails",
  "exemplifies",
  "hypernym",
  "mero_member",
  "mero_part",
  "mero_substance",
  "similar"
]);

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

function openWordNetTargetKey(value) {
  const target = typeof value === "string" ? value.trim() : "";
  const match = target.match(/^(.+)-([anrsv])$/u);
  return match ? `${match[2]}:${target}` : "";
}

export function parseOpenEnglishWordNetJsonFiles(files = []) {
  if (!Array.isArray(files)) throw invalid("Open English WordNet files must be an array");
  const rows = [];
  const relations = [];
  const sourceFiles = [];
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !OPEN_SYNSET_FILE.test(file.name)) continue;
    const source = typeof file.source === "string" ? file.source : "";
    let data;
    try {
      data = JSON.parse(source);
    } catch (error) {
      throw invalid("Open English WordNet JSON is malformed", { file: file.name, cause: error.message });
    }
    sourceFiles.push(file.name);
    for (const [synset, value] of Object.entries(data)) {
      const pos = value?.partOfSpeech;
      if (!WORDNET_POS.has(pos) || !Array.isArray(value?.members)) continue;
      const gloss = [
        ...(Array.isArray(value.definition) ? value.definition : []),
        ...(Array.isArray(value.example) ? value.example : [])
      ].filter((part) => typeof part === "string" && part.trim()).join("; ");
      for (const member of value.members) {
        const lemma = normalize(member);
        if (!lemma) continue;
        rows.push({
          id: `oewn:${pos}:${synset}:${lemma}:${hash(`${file.name}\u0000${synset}\u0000${lemma}`).slice(0, 12)}`,
          pos,
          synset,
          senseKey: `${synset}:${lemma}`,
          lemma,
          gloss
        });
      }
      for (const [relation, targets] of Object.entries(value)) {
        if (!OPEN_RELATION_FIELDS.has(relation) || !Array.isArray(targets)) continue;
        for (const target of targets) {
          const targetKey = openWordNetTargetKey(target);
          if (!targetKey) continue;
          relations.push({
            kind: "relation",
            id: `oewn-relation:${pos}:${synset}:${relation}:${target}`,
            source: `${pos}:${synset}`,
            target: targetKey,
            relation,
            evidence: "Open English WordNet 2025"
          });
        }
      }
    }
  }
  return {
    format: OPEN_ENGLISH_WORDNET_FORMAT,
    rows,
    relations,
    sourceFiles: sourceFiles.sort(),
    sourceRows: rows.length + relations.length
  };
}

async function loadOpenEnglishWordNetJson(directory) {
  const names = (await readdir(directory)).filter((name) => OPEN_SYNSET_FILE.test(name)).sort();
  const files = await Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(join(directory, name), "utf8")
  })));
  const parsed = parseOpenEnglishWordNetJsonFiles(files);
  const sourceHash = hash(files.map((file) => `${file.name}\u0000${file.source}`).join("\u0000"));
  return { ...parsed, sourceHash, path: resolve(directory) };
}

function lookupVariants(value) {
  const normalized = normalize(value);
  if (!normalized) return [];
  return [...new Set([normalized, normalized.replace(/ /gu, "_"), normalized.replace(/ /gu, "-")])];
}

function relationKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function buildEnglishWordNetIndex({ rows = [], relations = [], bridges = [] } = {}) {
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
  const bridgeIndex = buildEnglishWordNetBridgeIndex({ entries: bridges });
  return {
    rows: rows.map((row) => ({ ...row })),
    relations: relations.map((relation) => ({ ...relation })),
    byLemma,
    bySynset,
    relationGraph,
    bridgeIndex: bridgeIndex.bySense,
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
  if (![ENGLISH_WORDNET_FORMAT, OPEN_ENGLISH_WORDNET_FORMAT].includes(metadata.format)) {
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
  if (configuration?.format === OPEN_ENGLISH_WORDNET_FORMAT) {
    const parsed = await loadOpenEnglishWordNetJson(sourcePath);
    if (configuration.sourceHash && configuration.sourceHash !== parsed.sourceHash) {
      throw invalid("Open English WordNet source hash does not match configuration", {
        expected: configuration.sourceHash,
        actual: parsed.sourceHash
      });
    }
    return {
      ...parsed,
      configuration,
      index: buildEnglishWordNetIndex(parsed)
    };
  }
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

