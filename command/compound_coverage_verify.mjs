import { loadCoverage } from "./compound_coverage.mjs";
import { renderDerivedCompoundCoveragePya } from "../program/verbs/exchange/translation/compound_coverage.mjs";
import {
  createDefaultMindCompoundVerifier,
  verifyCompoundCoverage
} from "../program/verbs/exchange/translation/compound_verification.mjs";

export async function runCompoundCoverageVerification(args = process.argv.slice(2)) {
  const mode = args[0] ?? "summary";
  const mindName = args[1] ?? "compound verifier";
  const coverage = await loadCoverage();
  const invoke = await createDefaultMindCompoundVerifier({ mindName });
  const result = await verifyCompoundCoverage(coverage.records, { invoke, verifierName: mindName });

  if (mode === "pya") {
    return renderDerivedCompoundCoveragePya(result.records, {
      name: "translation_compounds_verified"
    });
  }
  if (mode === "summary") {
    return `${JSON.stringify({
      records: result.records.length,
      deterministic: result.deterministic.length,
      accepted: result.accepted.length,
      uncertain: result.uncertain.length,
      rejected: result.rejected.length
    }, null, 2)}\n`;
  }
  throw new Error(`unknown compound verification mode: ${mode}`);
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runCompoundCoverageVerification().then((output) => {
    process.stdout.write(output);
  }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
