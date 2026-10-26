import fs from "node:fs";
import fsp from "node:fs/promises";
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
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  buildRunId,
  encodeCheckpointText,
  loadCheckpointIndex,
  loadDefaultConfig,
  sanitizeRunId
} from "./run_pya_helpers.mjs";

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

async function appendCheckpointJournal({ runId, cwd, sentences }) {
  if (!runId || !Array.isArray(sentences) || sentences.length === 0) return null;
  const newspaperDir = resolve(cwd, "newspaper");
  const newspaperPath = resolve(newspaperDir, `${sanitizeRunId(runId)}.pya`);
  await fsp.mkdir(newspaperDir, { recursive: true });
  const lines = sentences
    .filter((sentence) => sentence?.mood === "ya" && sentence?.be === "checkpoint")
    .map((sentence) => {
      const safeSentence = { ...sentence };
      for (const key of ["fromtext", "totext"]) {
        if (typeof safeSentence[key]?.text !== "string") continue;
        safeSentence[key] = {
          ...safeSentence[key],
          text: encodeCheckpointText(safeSentence[key].text)
        };
      }
      return sentenceToPyash(safeSentence);
    });
  if (lines.length === 0) return newspaperPath;
  await fsp.appendFile(newspaperPath, `${lines.join("\n")}\n`, "utf8");
  return newspaperPath;
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
  checkpointCwd = process.cwd(),
  retryConfig,
  onEvoke,
  onStage,
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
  const effectiveCheckpointIndex = checkpointEnabled && checkpointIndex === undefined && runId
    ? await loadCheckpointIndex({ runId, cwd: checkpointCwd })
    : checkpointIndex;
  let checkpointPath = null;
  let checkpointWriteError = null;
  let checkpointWrite = Promise.resolve();
  const checkpointHandler = (sentence) => {
    checkpointWrite = checkpointWrite.then(async () => {
      if (checkpointWriteError) return;
      try {
        checkpointPath = await appendCheckpointJournal({
          runId,
          cwd: checkpointCwd,
          sentences: [sentence]
        });
      } catch (error) {
        checkpointWriteError = error;
      }
    });
    onCheckpoint?.(sentence);
  };
  const flushCheckpointJournal = async () => {
    await checkpointWrite;
    if (checkpointWriteError) throw checkpointWriteError;
  };
  let output;
  try {
    output = await runTranslationSourceToVliwRefinery({
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
      checkpointIndex: effectiveCheckpointIndex,
      checkpointEnabled,
      retryConfig,
      onEvoke,
      onStage,
      onCheckpoint: checkpointHandler,
      onRetry,
      compoundTranslation: compoundTranslation
        ? {
          ...compoundTranslation,
          languages: compoundTranslation.languages ?? COMPOUND_TRANSLATION_LANGUAGES
        }
        : null
    });
    await flushCheckpointJournal();
    const result = {
      ...output.result,
      ...(runId ? { runId } : {}),
      ...(checkpointPath ? { checkpointPath } : {})
    };
    report(JSON.stringify(result, null, 2));
    return { ...output, result, checkpointPath };
  } catch (error) {
    try {
      await flushCheckpointJournal();
    } catch (journalError) {
      error.checkpointError = journalError;
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret, entryPath: process.cwd() });
    const args = process.argv.slice(2);
    const runId = process.env.PYA_RUN_ID || await buildRunId({
      runTime: new Date().toISOString(),
      sourcePath: args[1],
      cwd: process.cwd()
    });
    const queueVocabulary = await createDefaultQueuedMindTranslationVocabularySubmitter();
    const queueWordNet = await createDefaultQueuedMindEnglishWordNetSenseSelectionSubmitter();
    const coverage = await loadCoverage();
    const compoundTranslator = await createDefaultQueuedCompoundTranslator();
    return runTranslationDocument(args, {
      runId,
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
