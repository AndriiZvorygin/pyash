import path from "node:path";

import { loadCheckpointIndex } from "./run_pya_helpers.mjs";
import { inspectTranslationRefineryArtifacts } from "../program/library/translation/translation_refinery_artifacts.mjs";

function usage() {
  throw new Error("usage: node command/read_translation_refinery.mjs <run-id> [checkpoint-cwd]");
}

const [runId, cwdArg] = process.argv.slice(2);
if (!runId) usage();

const cwd = path.resolve(cwdArg || process.cwd());
const checkpointIndex = await loadCheckpointIndex({ runId, cwd });
const report = inspectTranslationRefineryArtifacts({ checkpointIndex });
process.stdout.write(`${JSON.stringify({
  runId,
  cwd,
  ...report
}, null, 2)}\n`);
