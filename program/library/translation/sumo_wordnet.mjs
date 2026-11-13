import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../../program.mjs";

export const SUMO_CROSSWALK_CONFIG_PATH = "program/library/translation/sumo_wordnet.pya";
export const SUMO_CATALOG_PATH = "know/sumo/pyash_wordnet_mappings.pya";
export const SUMO_WORDNET_MAPPINGS = Object.freeze([
  "WordNetMappings30-adj.txt",
  "WordNetMappings30-adv.txt",
  "WordNetMappings30-noun.txt",
  "WordNetMappings30-verb.txt"
]);

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const SUMO_REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, "../../..");
const execFile = promisify(execFileCallback);
const SUMO_RELATIONS = new Map([
  ["=", "equivalent-to"],
  ["+", "subsumed-by"],
  ["@", "instance-of"],
  [":", "complement-of-equivalent"],
  ["[", "complement-of-subsumed-by"],
  ["]", "complement-of-instance"]
]);
const SENSE_KEY_POS = new Map([["1", "n"], ["2", "v"], ["3", "a"], ["4", "r"], ["5", "s"]]);
const OEWN_FILE = /^(?:adj|adv|noun|verb)\..+\.json$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function skipKifTrivia(source, state) {
  while (state.offset < source.length) {
    if (/\s/u.test(source[state.offset])) {
      state.offset += 1;
      continue;
    }
    if (source[state.offset] === ";") {
      while (state.offset < source.length && source[state.offset] !== "\n") state.offset += 1;
      continue;
    }
    break;
  }
}

function readKifValue(source, state) {
  skipKifTrivia(source, state);
  const first = source[state.offset];
  if (first === undefined) return undefined;
  if (first === "(") {
    state.offset += 1;
    const values = [];
    for (;;) {
      skipKifTrivia(source, state);
      if (state.offset >= source.length) throw new SyntaxError("unterminated KIF form");
      if (source[state.offset] === ")") {
        state.offset += 1;
        return values;
      }
      values.push(readKifValue(source, state));
    }
  }
  if (first === ")") throw new SyntaxError("unexpected KIF closing parenthesis");
  if (first === '"') {
    state.offset += 1;
    let value = "";
    while (state.offset < source.length) {
      const character = source[state.offset++];
      if (character === '"') return value;
      if (character === "\\" && state.offset < source.length) {
        const escaped = source[state.offset++];
        value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
      } else value += character;
    }
    throw new SyntaxError("unterminated KIF string");
  }
  const start = state.offset;
  while (state.offset < source.length && !/[\s();]/u.test(source[state.offset])) state.offset += 1;
  return source.slice(start, state.offset);
}

export function parseKifEnglishTermFormats(source) {
  const state = { offset: 0 };
  const labels = new Map();
  while (state.offset < source.length) {
    const form = readKifValue(source, state);
    if (Array.isArray(form)
      && form[0] === "termFormat"
      && form[1] === "EnglishWrittenLanguage"
      && typeof form[2] === "string"
      && typeof form[3] === "string") {
      labels.set(form[2], form[3]);
    }
  }
  return labels;
}

export function parseWordNetSenseIndex(source) {
  const bySynset = new Map();
  const bySenseKey = new Map();
  for (const line of String(source).split(/\r?\n/u)) {
    const match = line.trim().match(/^(\S+)%([1-5]):\S+\s+(\d{8})\s+\d+\s+\d+$/u);
    if (!match) continue;
    const [, lemmaAndLexicalId, sensePos, offset] = match;
    const pos = SENSE_KEY_POS.get(sensePos);
    const senseKey = `${lemmaAndLexicalId}%${sensePos}:${line.trim().split(/\s+/u)[0].split(":").slice(1).join(":")}`;
    const synsetId = `${pos}:${offset}`;
    const senses = bySynset.get(synsetId) ?? [];
    senses.push(senseKey);
    bySynset.set(synsetId, senses);
    const targets = bySenseKey.get(senseKey) ?? [];
    targets.push(synsetId);
    bySenseKey.set(senseKey, targets);
  }
  for (const values of bySynset.values()) values.sort();
  for (const values of bySenseKey.values()) values.sort();
  return { bySynset, bySenseKey };
}

async function readPinnedWordNet31SenseIndex(root, config) {
  const sourceId = config.get("wordnet-31-index");
  const expectedHash = config.get("wordnet-31-index-hash");
  if (!sourceId || !expectedHash) throw new Error("SUMO crosswalk requires a pinned WordNet 3.1 sense index");
  const source = await readFile(resolve(root, sourceId));
  const actualHash = sha256(source);
  if (actualHash !== expectedHash) {
    throw Object.assign(new Error("WordNet 3.1 sense index does not match the pinned crosswalk input"), {
      code: "stale-sumo-source",
      details: { sourceId, expected: expectedHash, actual: actualHash }
    });
  }
  return {
    ...parseWordNetSenseIndex(source.toString("utf8")),
    sourceId,
    sourceHash: actualHash
  };
}

export async function loadPinnedWordNet31SenseIndex({ root = SUMO_REPOSITORY_ROOT } = {}) {
  const source = await readFile(resolve(root, SUMO_CROSSWALK_CONFIG_PATH), "utf8");
  const config = mapValues(source, "sumo_wordnet_source");
  return readPinnedWordNet31SenseIndex(root, config);
}

export function parseSumoWordNetMappingLine(line) {
  const source = String(line).trim();
  if (!/^\d{8}\s/u.test(source)) return null;
  const separator = source.indexOf("|");
  if (separator < 0) return null;
  const header = source.slice(0, separator).trim().split(/\s+/u);
  if (header.length < 4 || !/^[anrsv]$/u.test(header[2])) return null;
  const wordCount = Number.parseInt(header[3], 16);
  if (!Number.isInteger(wordCount) || wordCount < 1 || header.length < 4 + wordCount * 2) return null;
  const lemmas = [];
  for (let index = 0; index < wordCount; index += 1) {
    const lemma = header[4 + index * 2].replaceAll("_", " ").trim();
    if (lemma) lemmas.push(lemma);
  }
  const mappingTail = source.slice(separator + 1);
  const mappings = [...mappingTail.matchAll(/&%([^\s=:+\[\]@]+)([=:+\[\]@])/gu)]
    .map((match) => ({ sumoId: match[1], symbol: match[2], relation: SUMO_RELATIONS.get(match[2]) }));
  return {
    wordNet30Id: `${header[2]}:${header[0]}`,
    pos: header[2],
    offset: header[0],
    lemmas: [...new Set(lemmas)],
    mappings
  };
}

function senseKeyLemma(senseKey) {
  return String(senseKey).split("%")[0].replaceAll("_", " ").toLowerCase();
}

export function buildSumoWordNetCrosswalk({
  mappingRows = [],
  senseKeysByWordNet30 = new Map(),
  wordNet31BySenseKey = new Map(),
  oewnSynsets = new Map(),
  termFormats = new Map()
} = {}) {
  const concepts = new Map();
  const mappings = [];
  for (const row of mappingRows) {
    for (const mapping of row.mappings ?? []) {
      const concept = concepts.get(mapping.sumoId) ?? {
        recordId: `sumo:${mapping.sumoId}`,
        kind: "sumo-concept",
        sumoId: mapping.sumoId,
        label: termFormats.get(mapping.sumoId) ?? mapping.sumoId,
        provenance: "SUMO WordNet 3.0 mapping; English term format"
      };
      concepts.set(mapping.sumoId, concept);

      const senseKeys = senseKeysByWordNet30.get(row.wordNet30Id) ?? [];
      const openIds = new Set();
      const matchedSenseKeys = new Set();
      for (const senseKey of senseKeys) {
        for (const wordNet31Id of wordNet31BySenseKey.get(senseKey) ?? []) {
          const [wordNet31Pos, offset] = wordNet31Id.split(":");
          const openEnglishWordNetId = `${wordNet31Pos}:${offset}-${wordNet31Pos}`;
          const synset = oewnSynsets.get(openEnglishWordNetId);
          if (!synset) continue;
          const members = new Set((synset.members ?? []).map((member) => String(member).toLowerCase()));
          if (members.has(senseKeyLemma(senseKey))) {
            openIds.add(openEnglishWordNetId);
            matchedSenseKeys.add(senseKey);
          }
        }
      }
      const openEnglishWordNetIds = [...openIds].sort();
      mappings.push({
        recordId: `sumo-map:wn30:${row.wordNet30Id}:${mapping.sumoId}`,
        kind: "wordnet-mapping",
        sumoId: mapping.sumoId,
        label: concept.label,
        aliases: [...row.lemmas],
        wordNet30Id: row.wordNet30Id,
        pos: row.pos,
        lemmas: [...row.lemmas],
        mappingSymbol: mapping.symbol,
        mappingRelation: mapping.relation,
        openEnglishWordNetIds,
        crosswalkStatus: openEnglishWordNetIds.length === 1
          ? "unique"
          : openEnglishWordNetIds.length > 1
            ? "ambiguous"
            : "unmatched",
        crosswalkEvidence: [...matchedSenseKeys].sort(),
        provenance: "SUMO WordNetMappings30; WordNet sense-key crosswalk through WordNet 3.1 to Open English WordNet 2025"
      });
    }
  }
  for (const [sumoId, label] of termFormats) {
    if (concepts.has(sumoId)) continue;
    concepts.set(sumoId, {
      recordId: `sumo:${sumoId}`,
      kind: "sumo-concept",
      sumoId,
      label,
      provenance: "SUMO English term format"
    });
  }
  return [...concepts.values(), ...mappings].sort((left, right) => left.recordId.localeCompare(right.recordId));
}

export function renderSumoWordNetCatalog(records, metadata = {}) {
  const lines = [
    "su name sumo_wordnet_evidence be map def",
    'su text "format" ob text "sumo-wordnet-crosswalk-v1" ya',
    `su text "metadata" ob text ${JSON.stringify(JSON.stringify(metadata))} ya`
  ];
  for (const record of records) {
    lines.push(`su text ${JSON.stringify(record.recordId)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

function mapValues(source, mapName) {
  const sentences = buildProgram(source).sentences;
  if (!sentences.some((sentence) => sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name === mapName)) {
    throw new Error(`missing Pyash map ${mapName}`);
  }
  return new Map(sentences
    .filter((sentence) => sentence?.mood === "ya" && typeof sentence.su?.text === "string" && typeof sentence.ob?.text === "string")
    .map((sentence) => [sentence.su.text, sentence.ob.text]));
}

async function checkPinnedFiles(root, hashes) {
  const sources = new Map();
  for (const [sourceId, expectedHash] of Object.entries(hashes)) {
    let source;
    try {
      source = await readFile(resolve(root, sourceId));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`required SUMO crosswalk input is missing: ${sourceId}`);
      throw error;
    }
    const actualHash = sha256(source);
    if (actualHash !== expectedHash) {
      throw Object.assign(new Error(`pinned SUMO crosswalk input changed: ${sourceId}`), {
        code: "stale-sumo-source",
        details: { expected: expectedHash, actual: actualHash }
      });
    }
    sources.set(sourceId, source);
  }
  return sources;
}

async function loadOpenEnglishWordNetCrosswalk(root, configPath) {
  const config = mapValues(await readFile(resolve(root, configPath), "utf8"), "translation_english_wordnet");
  const directory = resolve(root, config.get("source"));
  const files = [];
  for (const name of (await readdir(directory)).filter((value) => OEWN_FILE.test(value)).sort()) {
    files.push({ name, source: await readFile(join(directory, name), "utf8") });
  }
  const dataHash = sha256(Buffer.from(files.map(({ name, source }) => `${name}\u0000${source}`).join("\u0000")));
  if (config.get("source-hash") && dataHash !== config.get("source-hash")) {
    throw Object.assign(new Error("Open English WordNet source hash does not match its Pyash configuration"), {
      code: "stale-sumo-source",
      details: { expected: config.get("source-hash"), actual: dataHash }
    });
  }
  const synsets = new Map();
  for (const { source } of files) {
    for (const [sourceId, value] of Object.entries(JSON.parse(source))) {
      if (!/^[0-9]{8}-[anrsv]$/u.test(sourceId) || !Array.isArray(value?.members)) continue;
      const id = `${value.partOfSpeech}:${sourceId}`;
      synsets.set(id, { members: value.members, ili: value.ili ?? null });
    }
  }
  return { synsets, sourceHash: dataHash, config };
}

export async function loadPinnedSumoWordNetCatalog({ root = SUMO_REPOSITORY_ROOT } = {}) {
  const configSource = await readFile(resolve(root, SUMO_CROSSWALK_CONFIG_PATH), "utf8");
  const config = mapValues(configSource, "sumo_wordnet_source");
  const sumoRoot = config.get("sumo-source");
  const sourceDirectory = resolve(root, sumoRoot);
  const { stdout } = await execFile("git", ["-C", sourceDirectory, "rev-parse", "HEAD"]);
  if (stdout.trim() !== config.get("sumo-commit")) {
    throw Object.assign(new Error("SUMO checkout does not match the pinned revision"), {
      code: "stale-sumo-source",
      details: { expected: config.get("sumo-commit"), actual: stdout.trim() }
    });
  }
  const hashes = JSON.parse(config.get("source-hashes") ?? "{}");
  const sources = await checkPinnedFiles(root, hashes);
  const wordNet31 = await readPinnedWordNet31SenseIndex(root, config);
  const oewn = await loadOpenEnglishWordNetCrosswalk(root, config.get("open-wordnet-config"));
  const sense30 = parseWordNetSenseIndex(sources.get("know/sumo/WordNetMappings/index.sense").toString("utf8"));
  const sense31 = wordNet31;
  const termFormats = parseKifEnglishTermFormats(sources.get("know/sumo/domainEnglishFormat.kif").toString("utf8"));
  const mappingRows = SUMO_WORDNET_MAPPINGS.flatMap((name) => (
    sources.get(`know/sumo/WordNetMappings/${name}`).toString("utf8").split(/\r?\n/u)
      .map(parseSumoWordNetMappingLine)
      .filter((row) => row?.mappings.length)
  ));
  const records = buildSumoWordNetCrosswalk({
    mappingRows,
    senseKeysByWordNet30: sense30.bySynset,
    wordNet31BySenseKey: sense31.bySenseKey,
    oewnSynsets: oewn.synsets,
    termFormats
  });
  const crosswalkStats = records.filter((record) => record.kind === "wordnet-mapping").reduce((stats, record) => {
    stats[record.crosswalkStatus] += 1;
    return stats;
  }, { unique: 0, ambiguous: 0, unmatched: 0 });
  return {
    records,
    metadata: {
      sumoSource: config.get("sumo-source"),
      sumoCommit: config.get("sumo-commit"),
      mappingVersion: "WordNet 3.0",
      wordNet31Index: wordNet31.sourceId,
      openWordNet: "Open English WordNet 2025",
      openWordNetSourceHash: oewn.sourceHash,
      sourceHashes: Object.fromEntries([...sources].map(([sourceId, source]) => [sourceId, sha256(source)])),
      crosswalkStats,
      license: config.get("license"),
      citation: config.get("citation")
    }
  };
}

export async function importPinnedSumoWordNetCatalog({ root = SUMO_REPOSITORY_ROOT, outputPath } = {}) {
  const { records, metadata } = await loadPinnedSumoWordNetCatalog({ root });
  const destination = outputPath ?? resolve(root, SUMO_CATALOG_PATH);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, renderSumoWordNetCatalog(records, metadata), "utf8");
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { path: destination, recordCount: records.length, metadata };
}
