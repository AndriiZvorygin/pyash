#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DERIVED_COMPOUND_CURATED_NAME,
  renderDerivedCompoundCoveragePya,
  WORDNET_VERIFIED_COMPOUNDS_URL
} from "../program/library/translation/compound_coverage.mjs";
import { parseCompoundLexicon } from "../program/library/translation/compound_lexicon.mjs";
import {
  deduplicateCompoundSenseRecords,
  retireCompoundRecordsAboveMaximum
} from "../program/library/translation/compound_sense_dedupe.mjs";
import {
  ENGLISH_WORDNET_BRIDGE_CONFIG_URL,
  parseEnglishWordNetBridgeCatalog,
  renderEnglishWordNetBridgeCatalog
} from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  buildEnglishWordNetCompoundGlosses,
  mergeEnglishWordNetCompoundGlosses,
  parseEnglishWordNetCompoundGlosses,
  writeEnglishWordNetCompoundGlosses
} from "../program/library/translation/english_wordnet_compound_glosses.mjs";
import {
  ENGLISH_WORDNET_COMPOUND_DECISIONS_URL,
  parseEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisionAppend
} from "../program/library/translation/english_wordnet_compound_decisions.mjs";

const COMMAND_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(COMMAND_DIRECTORY, "..");
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, "artifacts");
const REPORT_DIRECTORY = join(ARTIFACT_ROOT, "wordnet-compound-sense-dedupe");
const GLOSS_URL = new URL("../program/library/translation/english_wordnet_compound_glosses.pya", import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

async function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function liveSweepLocks() {
  const lockPaths = [join(ARTIFACT_ROOT, ".wordnet-sense-compound-refinery.lock")];
  let entries = [];
  try {
    entries = await readdir(ARTIFACT_ROOT, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("wordnet-frequency-allocation-")) continue;
    lockPaths.push(join(ARTIFACT_ROOT, entry.name, "compound-verification", ".compound-sweep.lock"));
  }

  const active = [];
  for (const lockPath of lockPaths) {
    let contents;
    try {
      contents = await readFile(lockPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const pid = Number.parseInt(contents.trim(), 10);
    if (await processIsRunning(pid)) active.push({ lockPath, pid });
  }
  return active;
}

function renderReportPya(summary, changes) {
  const lines = [
    "su name translation_wordnet_compound_sense_dedupe_report be map def",
    `su text "format" ob text "wordnet-compound-sense-dedupe-v1" ya`
  ];
  for (const [key, value] of Object.entries(summary)) {
    lines.push(`su text ${JSON.stringify(key)} ob num ${value} ya`);
  }
  for (const change of changes) {
    lines.push(`su text ${JSON.stringify(change.senseId)} ob text ${JSON.stringify(JSON.stringify(change))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

function renderRetryQueuePya(records, maximumComponents) {
  const lines = [
    "su name translation_wordnet_two_part_compound_retry_queue be map def",
    'su text "format" ob text "wordnet-two-part-compound-retry-queue-v1" ya',
    `su text "maximum-compound-components" ob num ${maximumComponents} ya`
  ];
  for (const record of records) {
    lines.push(`su text ${JSON.stringify(record.senseId)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

export async function runWordNetCompoundSenseDedupe() {
  const activeLocks = await liveSweepLocks();
  if (activeLocks.length > 0) {
    throw new Error(`compound dedupe must wait for active sweep lock: ${activeLocks[0].lockPath} (pid ${activeLocks[0].pid})`);
  }

  const compoundPath = fileURLToPath(WORDNET_VERIFIED_COMPOUNDS_URL);
  const glossPath = fileURLToPath(GLOSS_URL);
  const bridgePath = fileURLToPath(ENGLISH_WORDNET_BRIDGE_CONFIG_URL);
  const decisionsPath = fileURLToPath(ENGLISH_WORDNET_COMPOUND_DECISIONS_URL);
  const [compoundSource, glossSource, bridgeSource, decisionsSource] = await Promise.all([
    readFile(compoundPath, "utf8"),
    readFile(glossPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(decisionsPath, "utf8")
  ]);
  const decisionState = parseEnglishWordNetCompoundDecisions(decisionsSource);
  const records = parseCompoundLexicon(compoundSource, {
    name: DERIVED_COMPOUND_CURATED_NAME,
    language: "canonical"
  });
  const deduped = deduplicateCompoundSenseRecords(records);
  const retired = retireCompoundRecordsAboveMaximum(deduped.records, 2);
  const result = {
    ...deduped,
    records: retired.records,
    retirements: retired.retirements,
    report: {
      ...deduped.report,
      triplesAfter: retired.records.filter((row) => row.pyashSequence?.length === 3).length
    }
  };
  const retiredSenseIds = new Set(retired.retirements.map((row) => row.senseId));
  const retainedSenseIds = new Set(result.records.map((row) => row.senseId).filter(Boolean));
  const rebuildSenseIds = new Set(result.removals.map((row) => row.senseId)
    .filter((senseId) => retainedSenseIds.has(senseId)));
  const selectedRecords = result.records.filter((row) => rebuildSenseIds.has(row.senseId));
  const rebuiltGlosses = buildEnglishWordNetCompoundGlosses(selectedRecords, decisionState.rows);
  const missingGlossSenseIds = [...rebuildSenseIds].filter((senseId) => (
    !rebuiltGlosses.some((row) => row.senseId === senseId)
  ));
  if (missingGlossSenseIds.length > 0) {
    throw new Error(`cannot preserve WordNet glosses for ${missingGlossSenseIds.length} deduplicated senses`);
  }

  const currentGlosses = parseEnglishWordNetCompoundGlosses(glossSource);
  const changedGlossSenseIds = new Set([...rebuildSenseIds, ...retiredSenseIds]);
  const retainedGlosses = currentGlosses.records.filter((row) => !changedGlossSenseIds.has(row.senseId));
  const nextGlosses = mergeEnglishWordNetCompoundGlosses(retainedGlosses, rebuiltGlosses);
  const bridgeCatalog = parseEnglishWordNetBridgeCatalog(bridgeSource);
  const retiredBridgeEntries = bridgeCatalog.entries.filter((entry) => retiredSenseIds.has(entry.source));
  const nextBridgeCatalog = {
    ...bridgeCatalog,
    entries: bridgeCatalog.entries.filter((entry) => !retiredSenseIds.has(entry.source))
  };
  const renderedBridges = renderEnglishWordNetBridgeCatalog(nextBridgeCatalog);
  const updatedDecisions = new Map(decisionState.rows.map((row) => [row.candidateId, { ...row }]));
  for (const removal of result.removals) {
    const promotionStatus = removal.pyashSequence.join(" ") === removal.keptSequence.join(" ")
      ? "already-active"
      : removal.pyashSequence.length > removal.keptSequence.length
        ? "longer-sequence-superseded"
        : "same-length-compound-not-selected";
    for (const id of removal.decisionIds) {
      const decision = updatedDecisions.get(id);
      if (decision) updatedDecisions.set(id, { ...decision, promotionStatus });
    }
  }
  for (const retirement of retired.retirements) {
    for (const id of retirement.decisionIds) {
      const decision = updatedDecisions.get(id);
      if (!decision) continue;
      updatedDecisions.set(id, {
        ...decision,
        promotionStatus: "retired-for-two-part-retry",
        retirementRevision: "retire-three-part-compounds-for-two-part-v1",
        retirementReason: "three-part compound removed from active coverage and queued for two-part recomposition"
      });
    }
  }
  const changedDecisions = [...updatedDecisions.values()].filter((row) => (
    JSON.stringify(decisionState.byId.get(row.candidateId)) !== JSON.stringify(row)
  ));
  const decisionAppends = changedDecisions.map(renderEnglishWordNetCompoundDecisionAppend).join("");
  const renderedCompounds = renderDerivedCompoundCoveragePya(result.records, {
    name: DERIVED_COMPOUND_CURATED_NAME
  });
  const parsedCompounds = parseCompoundLexicon(renderedCompounds, {
    name: DERIVED_COMPOUND_CURATED_NAME,
    language: "canonical"
  });
  const seenSenses = new Set();
  for (const row of parsedCompounds) {
    if (!row.senseId) continue;
    if (seenSenses.has(row.senseId)) throw new Error(`deduped output still contains duplicate sense ${row.senseId}`);
    seenSenses.add(row.senseId);
  }

  const beforeHash = sha256(compoundSource);
  const glossBeforeHash = sha256(glossSource);
  const bridgeBeforeHash = sha256(bridgeSource);
  const removalsBySense = new Map();
  for (const removal of result.removals) {
    const group = removalsBySense.get(removal.senseId) ?? [];
    group.push(removal);
    removalsBySense.set(removal.senseId, group);
  }
  for (const retirement of retired.retirements) {
    const group = removalsBySense.get(retirement.senseId) ?? [];
    group.push({
      ...retirement,
      reason: "overlength-compound-retired-for-two-part-retry",
      keptSequence: []
    });
    removalsBySense.set(retirement.senseId, group);
  }
  const changes = [...removalsBySense].map(([senseId, removals]) => {
    const kept = result.records.find((row) => row.senseId === senseId);
    return {
      senseId,
      ...(kept ? {
        keptTarget: kept.target,
        keptSequence: kept.pyashSequence,
        keptLayers: kept.componentLayers
      } : { queuedForTwoPartRetry: retiredSenseIds.has(senseId) }),
      removed: removals
    };
  });
  const summary = {
    "input-compound-records": result.report.inputRecordCount,
    "output-compound-records": result.records.length,
    "duplicate-senses": result.report.duplicateSenseCount,
    "removed-records": result.report.inputRecordCount - result.records.length,
    "senses-shortened": result.report.shorterSenseCount,
    "one-atom-trims": result.report.directTrimSenseCount,
    "equal-length-primitive-ties": result.report.equalLengthTieSenseCount,
    "three-part-records-before": result.report.triplesBefore,
    "three-part-records-after": result.report.triplesAfter,
    "retired-overlength-records": retired.report.retiredRecordCount,
    "two-part-retry-senses": retired.report.retiredSenseCount,
    "retired-bridge-rows": retiredBridgeEntries.length,
    "wordnet-gloss-rows-before": currentGlosses.records.length,
    "wordnet-gloss-rows-after": nextGlosses.length,
    "updated-decision-records": changedDecisions.length
  };
  const reportSource = renderReportPya(summary, changes);
  const retryQueue = renderRetryQueuePya(retired.retirements, 2);
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const compoundBackup = join(REPORT_DIRECTORY, `compound-coverage-before-${beforeHash}.pya`);
  const glossBackup = join(REPORT_DIRECTORY, `compound-glosses-before-${glossBeforeHash}.pya`);
  const bridgeBackup = join(REPORT_DIRECTORY, `wordnet-bridges-before-${bridgeBeforeHash}.pya`);
  for (const [path, contents] of [
    [compoundBackup, compoundSource],
    [glossBackup, glossSource],
    [bridgeBackup, bridgeSource]
  ]) {
    try {
      await access(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await atomicWrite(path, contents);
    }
  }
  await atomicWrite(join(REPORT_DIRECTORY, "report.pya"), reportSource);
  const retryQueuePath = join(REPORT_DIRECTORY, "two-part-retry-queue.pya");
  await atomicWrite(retryQueuePath, retryQueue);
  try {
    await atomicWrite(compoundPath, renderedCompounds);
    await writeEnglishWordNetCompoundGlosses(nextGlosses, { url: GLOSS_URL });
    await atomicWrite(bridgePath, renderedBridges);
    if (decisionAppends) await appendFile(decisionsPath, decisionAppends, "utf8");
  } catch (error) {
    await Promise.all([
      atomicWrite(compoundPath, compoundSource),
      atomicWrite(glossPath, glossSource),
      atomicWrite(bridgePath, bridgeSource)
    ]);
    throw error;
  }
  return {
    ...summary,
    reportPath: join(REPORT_DIRECTORY, "report.pya"),
    retryQueuePath,
    backupPath: compoundBackup,
    bridgeBackupPath: bridgeBackup,
    sampleChanges: changes.filter((change) => change.removed.some((row) => row.pyashSequence.length > 2))
      .slice(0, 8)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWordNetCompoundSenseDedupe()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
