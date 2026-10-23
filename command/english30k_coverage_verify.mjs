import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { verifyCompoundRecords } from "./compound_coverage_verify.mjs";
import {
  buildEnglish30kCompoundCoverage,
  loadEnglish30k
} from "../program/verbs/exchange/translation/english30k_coverage.mjs";

export async function runEnglish30kCoverageVerification(args = process.argv.slice(2)) {
  const mode = args[0] ?? "summary";
  const mindName = args[1] ?? "mind";
  const outputPath = args[2] ?? "";
  const source = await loadEnglish30k();
  const coverage = await buildEnglish30kCompoundCoverage({
    source,
    atomicEntries: pyashWords
  });
  return verifyCompoundRecords(coverage.records, { mode, mindName, outputPath });
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runEnglish30kCoverageVerification().then((output) => {
    process.stdout.write(output);
  }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
