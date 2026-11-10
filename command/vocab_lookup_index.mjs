#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { writeKwonLookupIndexes } from "../program/library/translation/kwon_lookup_index.mjs";

export async function rebuildVocabLookupIndexes() {
  return writeKwonLookupIndexes();
}

async function main() {
  const paths = await rebuildVocabLookupIndexes();
  for (const [kind, path] of Object.entries(paths)) console.log(`${kind}: ${path}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
