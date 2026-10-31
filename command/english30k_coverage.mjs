import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { loadCoverage } from "./compound_coverage.mjs";
import {
  buildEnglish30kCompoundCoverage,
  loadDefaultEnglish30kCoverage,
  loadEnglish30k,
  renderEnglish30kCoveragePya,
  summarizeEnglish30kCoverage
} from "../program/library/translation/english30k_coverage.mjs";
import { classifyCompoundCoverage } from "../program/library/translation/compound_verification.mjs";

async function buildCoverage() {
  const compounds = await loadCoverage();
  const coverage = await loadDefaultEnglish30kCoverage({
    atomicEntries: pyashWords,
    compoundRecords: compounds.accepted
  });
  const english30kCompounds = await buildEnglish30kCompoundCoverage({
    source: coverage.source,
    atomicEntries: pyashWords
  });
  const classified = classifyCompoundCoverage(english30kCompounds.records);
  const expanded = await loadDefaultEnglish30kCoverage({
    path: coverage.source.path,
    atomicEntries: pyashWords,
    compoundRecords: [
      ...compounds.accepted,
      ...english30kCompounds.accepted
    ]
  });
  return {
    coverage: expanded,
    candidates: english30kCompounds,
    classified
  };
}

export async function runEnglish30kCoverage(args = process.argv.slice(2), { report = console.log } = {}) {
  const mode = args[0] ?? "summary";
  const { coverage, candidates, classified } = await buildCoverage();
  if (mode === "summary") {
    report(JSON.stringify({
      ...summarizeEnglish30kCoverage(coverage),
      compoundRecords: candidates.records.length,
      compoundDeterministic: classified.deterministic.length,
      compoundVerificationCandidates: classified.verificationCandidates.length,
      compoundRejected: classified.rejected.length
    }, null, 2));
    return coverage;
  }
  if (mode === "unresolved") {
    for (const record of coverage.unresolved) {
      report(`${record.rank}\t${record.word}\t${record.score}`);
    }
    return coverage;
  }
  if (mode === "candidates") {
    for (const record of classified.verificationCandidates) {
      report(JSON.stringify(record));
    }
    return candidates;
  }
  if (mode === "covered") {
    for (const record of coverage.covered) {
      report(`${record.rank}\t${record.word}\t${record.coverageType}\t${record.pyashSequence.join(" ")}`);
    }
    return coverage;
  }
  if (mode === "lemmas") {
    for (const record of coverage.records.filter((row) => row.lemma)) {
      report(`${record.rank}\t${record.word}\t${record.lemma}\t${record.lemmaKind}\t${record.pyashSequence.join(" ")}`);
    }
    return coverage;
  }
  if (mode === "pya") {
    report(renderEnglish30kCoveragePya(coverage).trimEnd());
    return coverage;
  }
  throw new Error(`unknown English30k coverage mode: ${mode}`);
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runEnglish30kCoverage().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
