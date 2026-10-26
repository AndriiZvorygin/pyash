import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDefaultQueuedMindTranslationVocabularySubmitter } from "../program/verbs/exchange/translation/translation_vocabulary_queue.mjs";
import { loadCoverage } from "./compound_coverage.mjs";
import {
  COMPOUND_TRANSLATION_LANGUAGES,
  createDefaultQueuedCompoundTranslator
} from "../program/verbs/exchange/translation/compound_translation_cache.mjs";
import { createDefaultQueuedMindEnglishWordNetSenseSelectionSubmitter } from "../program/verbs/exchange/translation/english_wordnet_selection.mjs";
import { runTranslationSourceToVliwRefinery } from "../program/verbs/exchange/translation/translation_to_vliw_refinery.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

async function awaitGpuDuty(handleId, timeoutMs = Number(process.env.PYA_GPU_MANAGER_TIMEOUT_MS || 1800000)) {
  const completed = await interpret(parse(
    `accordingto text ${JSON.stringify(String(handleId ?? ""))} during num ${Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000))} vyah await be gpu do`
  ));
  const status = String(completed?.ob?.text ?? "").trim().toLowerCase();
  if (status !== "success") {
    throw new Error(`translation GPU duty ${handleId} completed with status ${status || "unknown"}`);
  }
  return String(completed?.result?.text ?? "");
}

function usageError(message) {
  const error = new Error(`${message}\nusage: node command/translate_document.mjs <language> <source.txt> <translation.pya> <catalog.pya> <pack.pyac>`);
  error.code = "invalid-usage";
  return error;
}

export async function runTranslationDocument(args = process.argv.slice(2), {
  report = console.log,
  queueVocabulary = null,
  compoundTranslation = null,
  wordnetRefinery = null,
  awaitVocabulary = null,
  runId = process.env.PYA_RUN_ID || null,
  checkpointIndex,
  checkpointEnabled = true,
  retryConfig,
  onEvoke,
  onCheckpoint,
  onRetry
} = {}) {
  if (args.length !== 5) throw usageError("translate_document requires language, source, translation catalog, PyAC catalog, and PyAC pack");
  const [language, sourcePath, translationPath, catalogPath, packPath] = args;
  const paths = {
    source: resolve(sourcePath),
    translation: resolve(translationPath),
    catalog: resolve(catalogPath),
    pack: resolve(packPath)
  };
  const source = fs.readFileSync(paths.source, "utf8");
  const output = await runTranslationSourceToVliwRefinery({
    language,
    source,
    locator: paths.source,
    sourcePath: paths.source,
    paths: {
      translation: paths.translation,
      catalog: paths.catalog,
      pack: paths.pack
    },
    queueVocabulary,
    awaitVocabulary,
    wordnetRefinery,
    runId,
    checkpointIndex,
    checkpointEnabled,
    retryConfig,
    onEvoke,
    onCheckpoint,
    onRetry,
    compoundTranslation: compoundTranslation
      ? {
        ...compoundTranslation,
        languages: compoundTranslation.languages ?? COMPOUND_TRANSLATION_LANGUAGES
      }
      : null
  });
  const { result } = output;
  report(JSON.stringify(result, null, 2));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret, entryPath: process.cwd() });
    const queueVocabulary = await createDefaultQueuedMindTranslationVocabularySubmitter();
    const queueWordNet = await createDefaultQueuedMindEnglishWordNetSenseSelectionSubmitter();
    const coverage = await loadCoverage();
    const compoundTranslator = await createDefaultQueuedCompoundTranslator();
    return runTranslationDocument(process.argv.slice(2), {
      queueVocabulary,
      wordnetRefinery: {
        submit: queueWordNet,
        compoundRecords: coverage.accepted,
        awaitHandle: awaitGpuDuty
      },
      awaitVocabulary: awaitGpuDuty,
      compoundTranslation: {
        records: coverage.accepted,
        languages: COMPOUND_TRANSLATION_LANGUAGES,
        translate: compoundTranslator
      }
    });
  })().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
