#!/usr/bin/env node

import fs from "node:fs/promises";

import { reviewVocabularyEntry } from "../program/library/translation/vocabulary_entry_review.mjs";

const [inputPath, ...extra] = process.argv.slice(2);
if (!inputPath || extra.length > 0) {
  console.error("Usage: node command/vocabulary_entry_review.mjs <one-entry.pya>");
  console.error("The entry records a target, gloss, Pyash form, POS-qualified WordNet sense, and review status.");
  process.exit(1);
}

try {
  const result = await reviewVocabularyEntry(await fs.readFile(inputPath, "utf8"));
  console.log(`${result.reviewStatus}: ${result.target} -> ${result.senseId}`);
  console.log(`  Pyash: ${result.pyashSequence.join(" ")}`);
  console.log(`  WordNet link: ${result.linkStatus}`);
  console.log(`  Review record: ${result.reviewId}`);
} catch (error) {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  if (error.rollbackFailures) console.error(JSON.stringify({ rollbackFailures: error.rollbackFailures }, null, 2));
  process.exitCode = 1;
}
