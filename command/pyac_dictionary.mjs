#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { buildDictionarySource } from "../program/library/dictionary/source.mjs";
import { decodePyashProgram } from "../program/library/vliw/index.mjs";
import { lookupLegacyName, lookupLegacyPyaName, lookupLegacyWord } from "../program/library/vliw/quotes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceVolumePath = path.join(root, "program/library/dictionary/reference.pyac");
const WORDNET_RELEASE = "Open English WordNet 2025";
const SUMO_RELEASE = "WordNet 3.0 mapping snapshot f0c126842d098a312e390479b38ecfbac018f8ed";
const binaryCandidates = [
  path.join(root, "rust/pyac/target/release/pyac-dictionary"),
  path.join(root, "rust/pyac/target/debug/pyac-dictionary")
];

function usageError(message) {
  return new Error(`${message}\nusage:\n  pyash dict <English word|Chinese form|WordNet sense|sumo:<concept>|Pyash key>\n  pyash dict <Pyash key> to zh\n  pyash dictionary volume build from <source.pya> to <volume.pyac>\n  pyash dictionary volume inspect <volume.pyac>\n  pyash dictionary volume lookup <volume.pyac> surface <language> <surface>\n  pyash dictionary volume lookup <volume.pyac> source <dataset> <release> <identifier>\n  pyash dictionary volume read <volume.pyac> key <pyash-name>\n  pyash dictionary volume benchmark <volume.pyac> surface <language> <surface> <iterations> to <record.pya>`);
}

async function executablePath() {
  for (const candidate of binaryCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // The Rust executable is built once during setup, never on command invocation.
    }
  }
  throw new Error(`pyac-dictionary executable is missing; build it once with: cargo build --release --manifest-path ${path.join(root, "rust/pyac/Cargo.toml")} --bin pyac-dictionary`);
}

function runBinary(binary, args, input) {
  const result = spawnSync(binary, args, {
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `pyac-dictionary exited ${result.status}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`pyac-dictionary returned invalid result: ${error.message}`);
  }
}

function binaryKey(name) {
  const words = String(name).trim().split(/\s+/u).filter(Boolean);
  if (!words.length) throw usageError("read requires a Pyash key");
  return words.map((word) => {
    const entry = lookupLegacyPyaName(word);
    if (!entry?.hnuc) throw new Error(`Pyash dictionary key has no HNUC mapping: ${word}`);
    return Number.parseInt(entry.hnuc, 16).toString(16);
  }).join(",");
}

export function dictionaryKeyName(words) {
  return words.map((word) => {
    const entry = lookupLegacyWord(Number(word));
    if (!entry?.pya) throw new Error(`HNUC has no Pyash spelling: ${word}`);
    return entry.pya;
  }).join(" ");
}

export function renderDefinitionSentence(sentence, canonicalKey) {
  const rendered = sentenceToPyash(sentence);
  const decodedKey = sentence?.su?.name;
  const decodedSubject = `su name ${decodedKey}`;
  if (!decodedKey || !rendered.startsWith(decodedSubject)) return rendered;
  return `su name ${canonicalKey}${rendered.slice(decodedSubject.length)}`;
}

function metricRecord(result) {
  const lines = [
    "su name criterion be series def",
    `su name criterion ob text ${JSON.stringify(`startedAt=${result.startedAt}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`host=${os.hostname()}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`platform=${process.platform}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`architecture=${process.arch}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`volume=${result.path}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`executableBytes=${result.executableBytes}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`volumeBytes=${result.volumeBytes}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`codeletCount=${result.codeletCount ?? 0}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`entryCount=${result.entryCount ?? 0}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`language=${result.language}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`surface=${result.surface}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`iterations=${result.iterations}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`warmupIterations=${result.warmupIterations}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`openMs=${Number(result.openMs ?? 0).toFixed(3)}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`lookupTotalNs=${result.lookupTotalNs}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`lookupMeanNs=${result.lookupMeanNs}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`lookupsPerSecond=${result.lookupsPerSecond}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`matchesPerIteration=${result.matchesPerIteration}`)} be text ya`,
    `su name run duration ms ob num ${Number(result.totalMs ?? 0).toFixed(3)} be number ya`,
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export function summarizeDictionaryEntry(sentences, canonicalKey) {
  const requestedKey = canonicalKey.split(/\s+/u).map((word) => (
    Number.parseInt((lookupLegacyPyaName(word) ?? lookupLegacyName(word)).hnuc, 16)
  ));
  const structureKey = ["tlat", "kwon"].map((word) => (
    Number.parseInt((lookupLegacyPyaName(word) ?? lookupLegacyName(word)).hnuc, 16)
  ));
  const structureSubject = structureKey.map((word) => lookupLegacyWord(word)?.en).join(" ");
  const isEntryRangeMarker = (sentence) => (
    sentence.su?.name === structureSubject
    && JSON.stringify(sentence.ob?.ve?.values) === JSON.stringify(requestedKey)
    && sentence.at?.ve?.values?.length === 4
  );
  const legacy = sentences.some(isEntryRangeMarker);
  const legacyRecordTypes = new Set([
    "entry", "lexical-form", "source-link", "source-gloss", "component", "task",
    "reference", "operation-signature", "operation-argument", "operation-result"
  ]);
  const entrySentences = [];
  const definitionSentences = [];
  let definitionsStarted = false;
  const caseShape = (sentence, cases, kinds) => {
    const present = ["ob", "as", "from", "to", "by", "with"]
      .filter((caseName) => sentence[caseName] !== undefined)
      .sort();
    return present.join(" ") === [...cases].sort().join(" ")
      && cases.every((caseName, index) => kinds[index] === "text"
        ? typeof sentence[caseName]?.text === "string"
        : Array.isArray(sentence[caseName]?.ve?.values));
  };
  const v4MetadataKind = (sentence) => {
    if (caseShape(sentence, ["as", "from", "to"], ["text", "text", "text"])) return "lexical-form";
    if (caseShape(sentence, ["as", "from", "to", "by"], ["text", "text", "text", "text"])) return "source-link";
    if (caseShape(sentence, ["as", "from", "to", "by", "with"], ["text", "text", "text", "text", "text"])) return "source-gloss";
    if (caseShape(sentence, ["from"], ["vector"])) return "component";
    if (caseShape(sentence, ["with"], ["vector"])) return "task";
    if (caseShape(sentence, ["to"], ["vector"])) return "reference";
    if (caseShape(sentence, ["by"], ["vector"])) return "operation-signature";
    if (caseShape(sentence, ["as", "from", "to"], ["vector", "text", "text"])) return "operation-argument";
    if (caseShape(sentence, ["as", "by", "with"], ["vector", "text", "text"])) return "operation-result";
    return null;
  };
  for (const sentence of sentences) {
    const kind = legacy
      ? (legacyRecordTypes.has(sentence.at?.text)
        ? sentence.at.text
        : isEntryRangeMarker(sentence) ? "entry" : null)
      : (definitionsStarted ? null : v4MetadataKind(sentence));
    if (kind) entrySentences.push({ ...sentence, dictionaryRecordKind: kind });
    else {
      definitionsStarted = true;
      definitionSentences.push(sentence);
    }
  }
  const entry = {
    lexicalForms: entrySentences.filter((sentence) => (sentence.dictionaryRecordKind ?? sentence.at?.text) === "lexical-form").map((sentence) => ({
      language: sentence.as?.text,
      surface: sentence.from?.text,
      normalized: sentence.to?.text
    })),
    sourceLinks: entrySentences.filter((sentence) => (sentence.dictionaryRecordKind ?? sentence.at?.text) === "source-link").map((sentence) => ({
      dataset: sentence.as?.text,
      release: sentence.from?.text,
      identifier: sentence.to?.text,
      relation: sentence.by?.text
    })),
    sourceGlosses: entrySentences.filter((sentence) => (sentence.dictionaryRecordKind ?? sentence.at?.text) === "source-gloss").map((sentence) => ({
      language: sentence.as?.text,
      dataset: sentence.from?.text,
      release: sentence.to?.text,
      identifier: sentence.by?.text,
      text: sentence.with?.text
    })),
    components: entrySentences.filter((sentence) => (sentence.dictionaryRecordKind ?? sentence.at?.text) === "component").map((sentence) => {
      const key = sentence.from?.ve?.values;
      if (Array.isArray(key)) return dictionaryKeyName(key);
      return sentence.from?.text ?? sentence.from?.name;
    })
  };
  const interimDefinitions = entry.sourceGlosses.filter((gloss) => gloss.dataset === "wordnet");
  return {
    entry,
    interimDefinitions,
    definitionType: definitionSentences.length ? "pyash" : interimDefinitions.length ? "wordnet-interim" : "none",
    sentences: definitionSentences,
    pyash: definitionSentences.map((sentence) => renderDefinitionSentence(sentence, canonicalKey)).join("\n")
  };
}

function summarizeEntryCodelets(match) {
  const sentences = decodePyashProgram(match.codelets.map((codelet) => Uint16Array.from(codelet)));
  const legacyMarker = sentences.find((sentence) => (
    sentence.su?.name === "word dictionary"
    && Array.isArray(sentence.ob?.ve?.values)
    && sentence.at?.ve?.values?.length === 4
  ));
  const key = legacyMarker
    ? dictionaryKeyName(legacyMarker.ob.ve.values)
    : sentences.find((sentence) => sentence.su?.name)?.su.name;
  if (!key) throw new Error("dictionary entry has no canonical Pyac key in its sentence stream");
  return { key, ...summarizeDictionaryEntry(sentences, key) };
}

function renderReferenceEntry(match, query) {
  const english = match.entry.lexicalForms
    .filter((form) => form.language === "en")
    .map((form) => form.surface);
  const lines = [`${query}: ${match.key}${english.length ? ` [${[...new Set(english)].join(", ")}]` : ""}`];
  for (const gloss of match.interimDefinitions) {
    lines.push(`  WordNet ${gloss.identifier}: ${gloss.text}`);
  }
  for (const link of match.entry.sourceLinks.filter((source) => source.dataset === "sumo")) {
    lines.push(`  SUMO ${link.identifier} (${link.relation})`);
  }
  for (const component of match.entry.components) {
    const known = lookupLegacyPyaName(component) ?? lookupLegacyName(component);
    if (known) lines.push(`  component: ${known.en} (${known.pya})`);
    else lines.push(`  component: ${component}`);
  }
  return lines.join("\n");
}

function renderChineseEntry(match) {
  const forms = match.entry.lexicalForms;
  const chinese = [...new Set(forms.filter((form) => form.language === "zh").map((form) => form.surface))];
  const mandarin = [...new Set(forms.filter((form) => form.language === "zh-Latn-pinyin").map((form) => form.surface))];
  const cantonese = [...new Set(forms.filter((form) => form.language === "yue-Latn-jyutping").map((form) => form.surface))];
  const english = [...new Set(forms.filter((form) => form.language === "en").map((form) => form.surface))];
  const components = match.entry.components.map((component) => {
    const known = lookupLegacyPyaName(component) ?? lookupLegacyName(component);
    return known ? `${known.en} (${known.pya})` : component;
  });
  return [
    chinese.length ? chinese.join("、") : "(no Chinese form linked)",
    `Pinyin: ${mandarin.length ? mandarin.join("; ") : "(unavailable)"}`,
    ...(cantonese.length ? [`Jyutping: ${cantonese.join("; ")}`] : []),
    `English: ${english.join(", ") || "(unavailable)"}`,
    ...(components.length ? [`English breakdown: ${components.join(" + ")}`] : []),
    `Pyash: ${match.key}`,
    ...match.interimDefinitions.map((gloss) => `WordNet ${gloss.identifier}: ${gloss.text}`)
  ].join("\n");
}

function sourceMatchEntries(result) {
  return result.matches.map(summarizeEntryCodelets);
}

async function runReferenceDictionary(args, { stdout = process.stdout } = {}) {
  if (!args.length || (args.at(-2) === "to" && args.at(-1) === "zh" && args.length <= 2)) {
    throw usageError("dictionary lookup requires an English word, Chinese form, WordNet sense id, or Pyash key");
  }
  const binary = await executablePath();
  try {
    await fs.access(referenceVolumePath);
  } catch {
    throw new Error(`reference dictionary volume is missing: ${referenceVolumePath}\nbuild it from program/library/dictionary/reference.pya with pyash dictionary volume build`);
  }

  if (args.at(-2) === "to" && args.at(-1) === "zh") {
    const key = args.slice(0, -2).join(" ").trim();
    const result = runBinary(binary, ["entry", referenceVolumePath, binaryKey(key)]);
    const entry = summarizeEntryCodelets(result);
    stdout.write(`${renderChineseEntry(entry)}\n`);
    return entry;
  }

  const query = args.join(" ").trim();
  if (!query) throw usageError("dictionary lookup requires a query");
  let result;
  if (/^[anrvs]:\d{8}-[anrvs]$/iu.test(query)) {
    result = runBinary(binary, ["source-entries", referenceVolumePath, "wordnet", WORDNET_RELEASE, query]);
  } else if (/^sumo:/iu.test(query)) {
    result = runBinary(binary, ["source-entries", referenceVolumePath, "sumo", SUMO_RELEASE, query.slice(5)]);
  } else if (args.every((word) => lookupLegacyPyaName(word))) {
    result = runBinary(binary, ["entry", referenceVolumePath, binaryKey(query)]);
    const entry = summarizeEntryCodelets(result);
    stdout.write(`${renderReferenceEntry(entry, query)}\n`);
    return entry;
  } else {
    const language = [...query].some((character) => /\p{Script=Han}/u.test(character)) ? "zh" : "en";
    result = runBinary(binary, ["surface-entries", referenceVolumePath, language, query]);
  }

  const entries = sourceMatchEntries(result);
  if (!entries.length) {
    stdout.write(`${query}: no dictionary entry found\n`);
    return { query, matches: [] };
  }
  stdout.write(`${entries.map((entry) => renderReferenceEntry(entry, query)).join("\n")}\n`);
  return { query, matches: entries };
}

export async function runPyacDictionary(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  if (args[0] === "reference") return runReferenceDictionary(args.slice(1), { stdout });
  const binary = await executablePath();
  let result;
  let benchmarkPath = null;
  if (args[0] === "build" && args[1] === "from" && args[3] === "to" && args.length === 5) {
    const sourcePath = path.resolve(args[2]);
    const volumePath = path.resolve(args[4]);
    const started = performance.now();
    const source = await fs.readFile(sourcePath, "utf8");
    const parsed = buildDictionarySource(source);
    const parsedMs = performance.now() - started;
    await fs.mkdir(path.dirname(volumePath), { recursive: true });
    result = runBinary(binary, ["build", volumePath], JSON.stringify(parsed));
    result.source = sourcePath;
    result.sourceBytes = Buffer.byteLength(source);
    result.sourceParseMs = Number(parsedMs.toFixed(3));
    result.totalMs = Number((performance.now() - started).toFixed(3));
  } else if (args[0] === "inspect" && args.length === 2) {
    result = runBinary(binary, ["inspect", path.resolve(args[1])]);
  } else if (args[0] === "lookup" && args[2] === "surface" && args.length === 5) {
    result = runBinary(binary, ["surface-entries", path.resolve(args[1]), args[3], args[4]]);
    result.matches = result.matches.map(summarizeEntryCodelets);
  } else if (args[0] === "lookup" && args[2] === "source" && args.length === 6) {
    result = runBinary(binary, ["source-entries", path.resolve(args[1]), args[3], args[4], args[5]]);
    result.matches = result.matches.map(summarizeEntryCodelets);
  } else if (args[0] === "read" && args[2] === "key" && args.length === 4) {
    result = runBinary(binary, ["entry", path.resolve(args[1]), binaryKey(args[3])]);
    result.sentences = decodePyashProgram(result.codelets.map((codelet) => Uint16Array.from(codelet)));
    const canonicalKey = args[3].trim().split(/\s+/u).join(" ");
    Object.assign(result, summarizeDictionaryEntry(result.sentences, canonicalKey));
    delete result.codelets;
  } else if (args[0] === "benchmark" && args[1] && args[2] === "surface" && args[6] === "to" && args.length === 8) {
    const volumePath = path.resolve(args[1]);
    const iterations = args[5];
    benchmarkPath = path.resolve(args[7]);
    const startedAt = new Date().toISOString();
    result = runBinary(binary, ["benchmark", volumePath, iterations, "surface", args[3], args[4]]);
    result.startedAt = startedAt;
    await fs.mkdir(path.dirname(benchmarkPath), { recursive: true });
    await fs.writeFile(benchmarkPath, metricRecord(result), "utf8");
  } else {
    throw usageError("invalid dictionary volume command");
  }
  if (benchmarkPath) result.record = benchmarkPath;
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPyacDictionary().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
