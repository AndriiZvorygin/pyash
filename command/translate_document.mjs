import fs from "node:fs";
import fsp from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runTranslationSourceToVliwRefinery } from "../program/verbs/exchange/translation/translation_to_vliw_refinery.mjs";
import {
  awaitTranslationGpuDuty,
  createDefaultTranslationVliwDependencies,
  rebindTranslationOutputCheckpoint
} from "../program/verbs/exchange/translation/translation_to_vliw_job.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  buildRunId,
  encodeCheckpointText,
  artifactRunPath,
  loadCheckpointIndex,
  loadDefaultConfig,
  sanitizeRunId
} from "./run_pya_helpers.mjs";

function usageError(message) {
  const error = new Error(`${message}\nusage: node command/translate_document.mjs <language> <source.txt> vliw\n   or: node command/translate_document.mjs <language> <source.txt> <translation.pya> <catalog.pya> <pack.pyac>`);
  error.code = "invalid-usage";
  return error;
}

function resolveTranslationPaths(args, { runId, artifactCwd }) {
  if (args.length === 5) {
    const [, sourcePath, translationPath, catalogPath, packPath] = args;
    return {
      goal: "vliw",
      source: resolve(sourcePath),
      translation: resolve(translationPath),
      catalog: resolve(catalogPath),
      pack: resolve(packPath),
      artifactFolder: null
    };
  }
  if (args.length !== 3 || String(args[2]).trim().toLowerCase() !== "vliw") {
    throw usageError("translate_document expects one semantic destination: vliw");
  }
  if (!runId) throw usageError("goal-mode translation requires a run id");
  const artifactFolder = resolve(artifactCwd, "artifacts", artifactRunPath(runId));
  return {
    goal: "vliw",
    source: resolve(args[1]),
    translation: join(artifactFolder, "translation.pya"),
    catalog: join(artifactFolder, "vliw-catalog.pya"),
    pack: join(artifactFolder, "vliw.pyac"),
    artifactFolder
  };
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
  onRetry,
  artifactCwd = null
} = {}) {
  if (args.length !== 3 && args.length !== 5) {
    throw usageError("translate_document requires a language, source, and semantic destination");
  }
  const language = args[0];
  const paths = resolveTranslationPaths(args, {
    runId,
    artifactCwd: artifactCwd ?? checkpointCwd ?? process.cwd()
  });
  if (paths.artifactFolder) await fsp.mkdir(paths.artifactFolder, { recursive: true });
  const source = fs.readFileSync(paths.source, "utf8");
  let effectiveCheckpointIndex = checkpointEnabled && checkpointIndex === undefined && runId
    ? await loadCheckpointIndex({ runId, cwd: checkpointCwd })
    : checkpointIndex;
  effectiveCheckpointIndex = rebindTranslationOutputCheckpoint({
    checkpointIndex: effectiveCheckpointIndex,
    paths
  });
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
      goal: paths.goal,
      ...(paths.artifactFolder ? { artifactFolder: paths.artifactFolder } : {}),
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
    const dependencies = await createDefaultTranslationVliwDependencies();
    const verbose = process.env.PYA_RUN_VERBOSE === "1";
    const verboseLog = (message) => {
      if (verbose) console.error(`[translation] ${message}`);
    };
    verboseLog(`run: ${runId}`);
    verboseLog(`goal: ${args.length === 3 ? args[2] : "vliw"}`);
    return runTranslationDocument(args, {
      runId,
      ...dependencies,
      onStage: (stage) => verboseLog(`stage: ${stage}`),
      onCheckpoint: (sentence) => verboseLog(`checkpoint: ${sentence?.su?.name || "unknown"}`),
      onRetry: (sentence) => verboseLog(`retry: ${sentence?.su?.name || "unknown"}`)
    });
  })().catch((error) => {
    if (process.env.PYA_RUN_VERBOSE === "1") console.error("[translation] failed");
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
