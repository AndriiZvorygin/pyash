#!/usr/bin/env node
// One-time repair: the shipped review catalog fails its own validator.
//
// 12 of its 14 rows carry `modelStatus: "accepted-curated"`, which is a member of
// REVIEW_STATUSES, not MODEL_STATUSES. The rows are hand-resolved primitive
// bindings (dvis, plus, gret, hgoc, swos, twic, syip, cyon, djan, no), recorded
// as if a model had chosen them. No model did, so the honest repair is to drop
// the field rather than relabel it as a deterministic or model decision.
//
// Rewrites the file through the module's own renderer so ordering and escaping
// match what `command/vocabulary_entry_review.mjs` writes.

import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { VOCABULARY_ENTRY_REVIEW_URL } from "../program/library/translation/vocabulary_entry_review.mjs";

const REVIEW_STATUSES = new Set(["review-needed", "accepted-curated", "rejected-curated", "deferred-curated"]);
const MODEL_STATUSES = new Set([
  "accepted-deterministic", "accepted-llm", "repaired-llm", "not-selected-llm",
  "rejected-deterministic", "rejected-llm", "uncertain-llm"
]);

const path = fileURLToPath(VOCABULARY_ENTRY_REVIEW_URL);
const source = await fs.readFile(path, "utf8");
const lines = source.split(/\r?\n/u);

let repaired = 0;
let kept = 0;
const output = lines.map((line) => {
  const match = line.match(/^su text (".*?") ob text (".*") ya$/u);
  if (!match) return line;
  let row;
  try {
    row = JSON.parse(JSON.parse(match[2]));
  } catch {
    return line;
  }
  if (row.modelStatus === undefined) return line;
  if (MODEL_STATUSES.has(row.modelStatus)) { kept += 1; return line; }
  if (!REVIEW_STATUSES.has(row.modelStatus)) {
    throw new Error(`row ${row.reviewId} has an unrecognised status: ${row.modelStatus}`);
  }
  // A review status in the model-status slot. The review itself is not being
  // changed; only the claim that a model produced it is removed.
  const { modelStatus: _dropped, ...rest } = row;
  repaired += 1;
  return `su text ${JSON.stringify(rest.reviewId)} ob text ${JSON.stringify(JSON.stringify(rest))} ya`;
});

await fs.writeFile(path, output.join("\n"));
console.log(`repaired ${repaired} rows, left ${kept} model-status rows untouched`);
