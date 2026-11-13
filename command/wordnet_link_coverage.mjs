#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDefaultEnglishSentenceResources } from "../program/library/translation/english_sentence.mjs";
import {
  englishWordNetTargetId,
  parseEnglishWordNetBridgeCatalog
} from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  parseEnglishWordNetCompoundGlosses
} from "../program/library/translation/english_wordnet_compound_glosses.mjs";
import { loadCoverage } from "./compound_coverage.mjs";
import { buildWordResolver } from "./wordnet_frequency_allocate.mjs";

const BRIDGE_PATH = new URL("../program/library/translation/english_wordnet_bridges.pya", import.meta.url);
const COMPOUND_GLOSSES_PATH = new URL("../program/library/translation/english_wordnet_compound_glosses.pya", import.meta.url);

function targetIdentity(kind, sequence, partOfSpeech) {
  return englishWordNetTargetId(kind, sequence, partOfSpeech);
}

export async function readWordNetLinkCoverage() {
  const [bridgeText, compoundGlossText, resources] = await Promise.all([
    readFile(BRIDGE_PATH, "utf8"),
    readFile(COMPOUND_GLOSSES_PATH, "utf8"),
    loadDefaultEnglishSentenceResources()
  ]);
  const coverage = await loadCoverage({ maximumCompoundComponents: 3, wordnetIndex: resources.wordnet.index });
  const resolveWord = buildWordResolver(resources, coverage);
  const bridges = parseEnglishWordNetBridgeCatalog(bridgeText).entries;
  const compoundGlosses = parseEnglishWordNetCompoundGlosses(compoundGlossText).records;

  const atomSynsets = new Set();
  const compoundBridgeSynsets = new Set();
  const unresolvedBridgeSynsets = new Set();
  const atomTargetIds = new Set();
  const atomSequences = new Set();
  const compoundBridgeTargetIds = new Set();

  for (const bridge of bridges) {
    const result = resolveWord(bridge.target, {
      partOfSpeech: bridge.targetPartOfSpeech,
      senseId: bridge.source
    });
    const sequence = Array.isArray(result?.pyashSequence) ? result.pyashSequence : [];
    if (sequence.length === 0) {
      unresolvedBridgeSynsets.add(bridge.source);
      continue;
    }
    const kind = result?.coverageType === "compound" || sequence.length > 1 ? "compound" : "atom";
    if (kind === "compound") {
      compoundBridgeSynsets.add(bridge.source);
      compoundBridgeTargetIds.add(targetIdentity(kind, sequence, bridge.targetPartOfSpeech));
    } else {
      atomSynsets.add(bridge.source);
      atomTargetIds.add(targetIdentity(kind, sequence, bridge.targetPartOfSpeech));
      atomSequences.add(sequence.join(" "));
    }
  }

  const compoundGlossSynsets = new Set(compoundGlosses
    .filter((record) => Array.isArray(record.pyashSequence) && record.pyashSequence.length >= 2)
    .map((record) => record.senseId));
  const compoundSynsets = new Set(compoundGlossSynsets);
  const compoundTargetIds = new Set(compoundGlosses
    .filter((record) => Array.isArray(record.pyashSequence) && record.pyashSequence.length >= 2)
    .map((record) => targetIdentity("compound", record.pyashSequence, record.partOfSpeech)));
  const compoundSequences = new Set(compoundGlosses
    .filter((record) => Array.isArray(record.pyashSequence) && record.pyashSequence.length >= 2)
    .map((record) => record.pyashSequence.join(" ")));

  for (const senseId of compoundBridgeSynsets) compoundSynsets.add(senseId);
  for (const targetId of compoundBridgeTargetIds) compoundTargetIds.add(targetId);

  const overlap = [...atomSynsets].filter((senseId) => compoundSynsets.has(senseId));
  const linkedSynsets = new Set([...atomSynsets, ...compoundSynsets]);
  const linkedPartOfSpeechCounts = {};
  for (const senseId of linkedSynsets) {
    const pos = senseId.slice(0, 1);
    linkedPartOfSpeechCounts[pos] = (linkedPartOfSpeechCounts[pos] ?? 0) + 1;
  }

  return {
    snapshot: new Date().toISOString(),
    atomSynsetLinks: atomSynsets.size,
    uniqueAtomPyacForms: atomSequences.size,
    uniqueAtomTargetIdentities: atomTargetIds.size,
    compoundSynsetLinks: compoundSynsets.size,
    compoundGlossSynsets: compoundGlossSynsets.size,
    compoundBridgeOnlySynsets: [...compoundBridgeSynsets].filter((senseId) => !compoundGlossSynsets.has(senseId)).length,
    uniqueCompoundPyacForms: compoundSequences.size,
    uniqueCompoundTargetIdentities: compoundTargetIds.size,
    uniqueLinkedSynsets: linkedSynsets.size,
    synsetsLinkedToBothKinds: overlap.length,
    unresolvedBridgeSynsets: unresolvedBridgeSynsets.size,
    bridgeRows: bridges.length,
    compoundGlossRows: compoundGlosses.length,
    linkedPartOfSpeechCounts
  };
}

async function main() {
  const report = await readWordNetLinkCoverage();
  const number = (value) => Number(value).toLocaleString("en-US");
  console.log(`WordNet-linked Pyash vocabulary (${report.snapshot})`);
  console.log(`Atom links: ${number(report.atomSynsetLinks)} synsets across ${number(report.uniqueAtomPyacForms)} Pyac atom forms`);
  console.log(`Compound links: ${number(report.compoundSynsetLinks)} synsets across ${number(report.uniqueCompoundPyacForms)} Pyac compound forms`);
  console.log(`Compound link sources: ${number(report.compoundGlossSynsets)} compound-gloss synsets + ${number(report.compoundBridgeOnlySynsets)} bridge-only synsets`);
  console.log(`Unique linked synsets: ${number(report.uniqueLinkedSynsets)}`);
  console.log(`Linked to both an atom and a compound: ${number(report.synsetsLinkedToBothKinds)}`);
  console.log(`Unresolved bridge rows: ${number(report.unresolvedBridgeSynsets)} of ${number(report.bridgeRows)}`);
  console.log(`By WordNet part of speech: ${Object.entries(report.linkedPartOfSpeechCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pos, count]) => `${pos} ${number(count)}`).join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
