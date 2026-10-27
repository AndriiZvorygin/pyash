import fs from "node:fs/promises";
import path from "node:path";

import { interpret } from "../../../bridge/index.mjs";
import { parse } from "../../../understand/index.mjs";
import { loadCoverage } from "../../../../command/compound_coverage.mjs";
import { createDefaultQueuedMindTranslationVocabularySubmitter } from "./translation_vocabulary_queue.mjs";
import { createDefaultQueuedMindEnglishWordNetSenseSelectionSubmitter } from "./english_wordnet_selection.mjs";
import {
  COMPOUND_TRANSLATION_LANGUAGES,
  createDefaultQueuedCompoundTranslator
} from "./compound_translation_cache.mjs";
import { runTranslationSourceToVliwRefinery } from "./translation_to_vliw_refinery.mjs";
import { artifactRunPath, loadCheckpointIndex } from "../../../../command/run_pya_helpers.mjs";

export async function awaitTranslationGpuDuty(
  handleId,
  timeoutMs = Number(process.env.PYA_GPU_MANAGER_TIMEOUT_MS || 1800000)
) {
  const completed = await interpret(parse(
    `accordingto text ${JSON.stringify(String(handleId ?? ""))} during num ${Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000))} vyah await be gpu do`
  ));
  const status = String(completed?.ob?.text ?? "").trim().toLowerCase();
  if (status !== "success") {
    throw new Error(`translation GPU duty ${handleId} completed with status ${status || "unknown"}`);
  }
  return String(completed?.result?.text ?? "");
}

export async function createDefaultTranslationVliwDependencies() {
  const [queueVocabulary, wordnetSubmit, coverage, compoundTranslator] = await Promise.all([
    createDefaultQueuedMindTranslationVocabularySubmitter(),
    createDefaultQueuedMindEnglishWordNetSenseSelectionSubmitter(),
    loadCoverage(),
    createDefaultQueuedCompoundTranslator()
  ]);
  return {
    queueVocabulary,
    awaitVocabulary: awaitTranslationGpuDuty,
    wordnetRefinery: {
      submit: wordnetSubmit,
      compoundRecords: coverage.accepted,
      awaitHandle: awaitTranslationGpuDuty
    },
    compoundTranslation: {
      records: coverage.accepted,
      languages: COMPOUND_TRANSLATION_LANGUAGES,
      translate: compoundTranslator
    }
  };
}

function checkpointOutputPaths(checkpointIndex) {
  const refinery = checkpointIndex?.get?.("translation source vliw");
  const checkpoint = refinery?.get?.("write outputs");
  return checkpoint?.resultSentence?.ob?.map?.result ?? null;
}

export function rebindTranslationOutputCheckpoint({ checkpointIndex, paths }) {
  const result = checkpointOutputPaths(checkpointIndex);
  if (!result || (
    result.translation === paths.translation
    && result.catalog === paths.catalog
    && result.pack === paths.pack
  )) return checkpointIndex;
  const refinery = checkpointIndex?.get?.("translation source vliw");
  if (!(refinery instanceof Map)) return checkpointIndex;
  const rebound = new Map(checkpointIndex);
  const stages = new Map(refinery);
  stages.delete("lower vliw");
  stages.delete("write outputs");
  rebound.set("translation source vliw", stages);
  return rebound;
}

function resolveSourcePath(sourcePath, cwd) {
  if (!sourcePath) throw new Error("translation source-to-VLIW operation requires a source filename");
  return path.resolve(cwd, sourcePath);
}

function resultPaths({ artifactFolder, source, translation, catalog, pack, runId }) {
  return {
    goal: "vliw",
    runId,
    source,
    artifactFolder,
    translation,
    catalog,
    pack
  };
}

export async function runTranslationVliwJob({
  sourcePath,
  language = "english",
  cwd = process.cwd(),
  runId = process.env.PYA_RUN_ID || null,
  checkpointIndex,
  checkpointEnabled = true,
  retryConfig,
  dependencies = null,
  onEvoke,
  onStage,
  onCheckpoint,
  onRetry
} = {}) {
  if (!runId) throw new Error("translation source-to-VLIW operation requires a run id");
  const source = resolveSourcePath(sourcePath, cwd);
  const artifactFolder = path.resolve(cwd, "artifacts", artifactRunPath(runId));
  const paths = {
    translation: path.join(artifactFolder, "translation.pya"),
    catalog: path.join(artifactFolder, "vliw-catalog.pya"),
    pack: path.join(artifactFolder, "vliw.pyac")
  };
  await fs.mkdir(artifactFolder, { recursive: true });
  const sourceText = await fs.readFile(source, "utf8");
  const loadedDependencies = dependencies ?? await createDefaultTranslationVliwDependencies();
  const loadedCheckpointIndex = checkpointIndex === undefined && checkpointEnabled
    ? await loadCheckpointIndex({ runId, cwd })
    : checkpointIndex;
  const effectiveCheckpointIndex = rebindTranslationOutputCheckpoint({
    checkpointIndex: loadedCheckpointIndex,
    paths
  });
  const output = await runTranslationSourceToVliwRefinery({
    language,
    source: sourceText,
    locator: source,
    sourcePath: source,
    paths,
    ...loadedDependencies,
    runId,
    checkpointIndex: effectiveCheckpointIndex,
    checkpointEnabled,
    retryConfig,
    onEvoke,
    onStage,
    onCheckpoint,
    onRetry
  });
  return {
    ...output,
    result: resultPaths({
      artifactFolder,
      source,
      ...paths,
      runId,
      ...(output.result ?? {})
    })
  };
}
