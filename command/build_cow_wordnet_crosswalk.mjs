#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadDefaultEnglishSentenceResources } from "../program/library/translation/english_sentence.mjs";
import { loadEnglishWordNetFrequencyResources } from "../program/library/translation/english_wordnet_frequency.mjs";
import { loadChineseCharacterAtomRefineryInputs } from "../program/library/translation/chinese_character_atom_refinery.mjs";
import {
  buildCowWordNetSenseCrosswalk,
  COW_WORDNET_CROSSWALK_FORMAT,
  renderCowWordNetCrosswalkPya
} from "../program/library/translation/cow_wordnet_crosswalk.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(ROOT, "program/library/translation/cow_wordnet_crosswalk.pya");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadOptionalWordNetFrequencyResources() {
  try {
    return await loadEnglishWordNetFrequencyResources();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    process.stderr.write("[cow-wordnet-crosswalk] Princeton tag counts unavailable; sense counts remain unknown\n");
    return { sourceHash: "princeton-wordnet-frequency-unavailable", joined: { entries: [] } };
  }
}

async function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, filePath);
}

export async function buildAndWriteCowWordNetCrosswalk({ outputPath = OUTPUT_PATH } = {}) {
  const [inputs, wordnet, frequency] = await Promise.all([
    loadChineseCharacterAtomRefineryInputs(),
    loadDefaultEnglishSentenceResources(),
    loadOptionalWordNetFrequencyResources()
  ]);
  if (!inputs.cowWordNet) throw new Error("COW source inputs did not include parsed WordNet lexical senses");

  const { records, report } = buildCowWordNetSenseCrosswalk({
    cow: inputs.cowWordNet,
    wordnetRows: wordnet.wordnet.rows,
    english30kRows: wordnet.source.rows,
    wordnetFrequencyEntries: frequency.joined?.entries ?? [],
    subtlex: inputs.subtlex,
    junda: inputs.junda
  });
  const sourceHashes = {
    cow: inputs.sourceHashes.cowCharacterSenses,
    openEnglishWordNet: wordnet.wordnet.sourceHash,
    english30k: wordnet.resourceHashes?.english30k ?? wordnet.source.sourceHash,
    princetonWordNetFrequency: frequency.sourceHash ?? "",
    subtlexCharacterFrequency: inputs.sourceHashes.subtlex,
    jundaCharacterFrequency: inputs.sourceHashes.junda
  };
  const sourceHash = sha256(JSON.stringify(sourceHashes));
  const contents = renderCowWordNetCrosswalkPya(records, {
    source: `Chinese Open Wordnet 1.1 and Open English WordNet joined by ILI; format ${COW_WORDNET_CROSSWALK_FORMAT}`,
    sourceHash,
    sourceHashes
  });
  await atomicWrite(outputPath, contents);
  return { outputPath, sourceHash, sourceHashes, report };
}

export async function main() {
  const result = await buildAndWriteCowWordNetCrosswalk();
  const { report } = result;
  process.stdout.write(`COW synsets: ${report.cowSynsetCount}\n`);
  process.stdout.write(`COW synsets with ILI: ${report.cowSynsetsWithIli}\n`);
  process.stdout.write(`COW synsets without ILI: ${report.cowSynsetsWithoutIli}\n`);
  process.stdout.write(`COW synsets joined to local WordNet: ${report.cowSynsetsMatched}\n`);
  process.stdout.write(`COW ILIs missing from local WordNet: ${report.cowIlisMissingFromWordNet}\n`);
  process.stdout.write(`Chinese forms with a joined sense: ${report.chineseFormsMatched}\n`);
  process.stdout.write(`Local WordNet sense rows written: ${report.wordnetSenseRows}\n`);
  process.stdout.write(`Form-to-sense rows written: ${report.formSenseRows}\n`);
  process.stdout.write(`Preferred form-to-sense rows: ${report.preferredFormSenseRows}\n`);
  process.stdout.write(`Chinese forms with unresolved top-sense frequency ties: ${report.chineseFormsWithTopSenseFrequencyTies}\n`);
  process.stdout.write(`Crosswalk: ${result.outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
