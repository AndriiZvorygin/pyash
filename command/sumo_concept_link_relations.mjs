#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSumoLinkIndex,
  parseSumoConceptLinkRows,
  reconcileSumoConceptLinkRelations,
  renderSumoConceptLinkRows
} from "../program/library/translation/sumo_concept_evidence.mjs";
import {
  buildAcceptedReferenceSource,
  loadReferenceSourceInputs
} from "../program/library/dictionary/build_reference_source.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = path.join(REPOSITORY_ROOT, "program/library/translation/sumo_concept_links.pya");

/**
 * The counts of a relation repair, grouped by the transition each record took.
 */
export function summarizeSumoConceptRelationChanges(changes = []) {
  const transitions = new Map();
  const paths = new Map();
  for (const change of changes) {
    const key = `${change.from}->${change.to}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    paths.set(change.path, (paths.get(change.path) ?? 0) + 1);
  }
  return {
    changeCount: changes.length,
    transitions: Object.fromEntries([...transitions].sort()),
    paths: Object.fromEntries([...paths].sort())
  };
}

/**
 * Rewrites the relation of every promoted link from its evidence. The
 * identifiers, the target, and the recorded evidence stay untouched; only a
 * relation the evidence does not support is corrected.
 */
export async function repairSumoConceptLinkRelations({
  catalogPath = CATALOG_PATH,
  report = console.log
} = {}) {
  const records = parseSumoConceptLinkRows(await fs.readFile(catalogPath, "utf8"));
  const inputs = await loadReferenceSourceInputs();
  const { entries } = buildAcceptedReferenceSource({ ...inputs, render: false });
  const linkIndex = buildSumoLinkIndex(entries);
  const { records: reconciled, changes } = reconcileSumoConceptLinkRelations(records, { linkIndex });
  const summary = summarizeSumoConceptRelationChanges(changes);
  report(JSON.stringify({
    event: "sumo-concept-relation-repair",
    recordCount: records.length,
    ...summary
  }));
  if (!changes.length) return { path: catalogPath, recordCount: records.length, ...summary };
  const temporary = `${catalogPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, renderSumoConceptLinkRows(reconciled), "utf8");
  await fs.rename(temporary, catalogPath);
  return { path: catalogPath, recordCount: records.length, ...summary };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    await repairSumoConceptLinkRelations();
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
