import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lowerTranslationToPyac,
  renderTranslationPipelinePya,
  translateDocument
} from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import {
  createDefaultQueuedMindTranslationVocabularySubmitter,
  submitTranslationVocabularyCandidates
} from "../program/verbs/exchange/translation/translation_vocabulary_queue.mjs";
import { loadCoverage } from "./compound_coverage.mjs";
import {
  COMPOUND_TRANSLATION_LANGUAGES,
  createDefaultQueuedCompoundTranslator,
  ensureCompoundTranslations,
  selectCompoundDemands
} from "../program/verbs/exchange/translation/compound_translation_cache.mjs";
import { writeVliwDatabaseFiles } from "../program/library/vliw/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

function usageError(message) {
  const error = new Error(`${message}\nusage: node command/translate_document.mjs <language> <source.txt> <translation.pya> <catalog.pya> <pack.pyac>`);
  error.code = "invalid-usage";
  return error;
}

export async function runTranslationDocument(args = process.argv.slice(2), {
  report = console.log,
  queueVocabulary = null,
  compoundTranslation = null
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
  const translation = await translateDocument({
    language,
    text: source,
    locator: paths.source
  });
  const queued = queueVocabulary
    ? await submitTranslationVocabularyCandidates({
      result: translation,
      sourceText: source,
      submit: queueVocabulary
    })
    : { result: translation, submitted: false, submittedCount: 0, handleId: "" };
  const finalTranslation = queued.result;
  const compoundDemands = compoundTranslation
    ? selectCompoundDemands(source, compoundTranslation.records ?? [])
    : [];
  const compoundCache = compoundTranslation
    ? await ensureCompoundTranslations({
      compounds: compoundDemands,
      languages: compoundTranslation.languages ?? COMPOUND_TRANSLATION_LANGUAGES,
      cachePath: compoundTranslation.cachePath,
      translate: compoundTranslation.translate,
      context: finalTranslation.records.map((record) => record.source.text),
      onEvent: compoundTranslation.onEvent
    })
    : null;
  fs.writeFileSync(paths.translation, renderTranslationPipelinePya(finalTranslation), "utf8");
  const database = lowerTranslationToPyac(finalTranslation);
  writeVliwDatabaseFiles(database, {
    catalogPath: paths.catalog,
    packPath: paths.pack
  });
  const result = {
    command: "translate-document",
    language: finalTranslation.language,
    source: paths.source,
    translation: paths.translation,
    catalog: paths.catalog,
    pack: paths.pack,
    records: finalTranslation.records.length,
    resolved: finalTranslation.counts.resolved,
    provisional: finalTranslation.counts.provisional,
    unresolved: finalTranslation.counts.unresolved,
    vocabularyCandidates: finalTranslation.vocabularyCandidates.length,
    vocabularySubmitted: queued.submittedCount,
    vocabularyQueueHandle: queued.handleId || null,
    compoundRequests: compoundCache?.requested ?? 0,
    compoundCacheHits: compoundCache?.counts.hits ?? 0,
    compoundTranslations: compoundCache?.counts.translated ?? 0,
    compoundTranslationPartials: compoundCache?.counts.partial ?? 0,
    compoundTranslationFailures: compoundCache?.counts.failed ?? 0,
    compoundTranslationCache: compoundCache?.cachePath ?? null,
    executable: database.catalog.executableCount,
    unsupported: database.catalog.unsupportedCount,
    packHash: database.catalog.packHash
  };
  report(JSON.stringify(result, null, 2));
  return { translation: finalTranslation, database, compoundCache, result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret, entryPath: process.cwd() });
    const queueVocabulary = await createDefaultQueuedMindTranslationVocabularySubmitter();
    const coverage = await loadCoverage();
    const compoundTranslator = await createDefaultQueuedCompoundTranslator();
    return runTranslationDocument(process.argv.slice(2), {
      queueVocabulary,
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
