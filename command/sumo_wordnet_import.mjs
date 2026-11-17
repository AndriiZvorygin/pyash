#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importPinnedSumoWordNetCatalog } from "../program/library/translation/sumo_wordnet.mjs";
import { writeKwonSumoLookupIndex } from "../program/library/translation/kwon_lookup_index.mjs";

export async function runSumoWordNetImport() {
  const imported = await importPinnedSumoWordNetCatalog();
  const indexPath = await writeKwonSumoLookupIndex();
  return { ...imported, indexPath };
}

async function main() {
  const result = await runSumoWordNetImport();
  const { unique, ambiguous, unmatched } = result.metadata.crosswalkStats;
  console.log(`SUMO WordNet evidence: ${result.recordCount} records`);
  console.log(`WordNet 3.0 crosswalk: ${unique} unique, ${ambiguous} ambiguous, ${unmatched} unmatched`);
  console.log(`local Pyash catalog: ${result.path}`);
  console.log(`Kwon SUMO index: ${result.indexPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
