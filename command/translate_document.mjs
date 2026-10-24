import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lowerTranslationToPyac,
  renderTranslationPipelinePya,
  translateDocument
} from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import { writeVliwDatabaseFiles } from "../program/library/vliw/index.mjs";

function usageError(message) {
  const error = new Error(`${message}\nusage: node command/translate_document.mjs <language> <source.txt> <translation.pya> <catalog.pya> <pack.pyac>`);
  error.code = "invalid-usage";
  return error;
}

export async function runTranslationDocument(args = process.argv.slice(2), { report = console.log } = {}) {
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
  fs.writeFileSync(paths.translation, renderTranslationPipelinePya(translation), "utf8");
  const database = lowerTranslationToPyac(translation);
  writeVliwDatabaseFiles(database, {
    catalogPath: paths.catalog,
    packPath: paths.pack
  });
  const result = {
    command: "translate-document",
    language: translation.language,
    source: paths.source,
    translation: paths.translation,
    catalog: paths.catalog,
    pack: paths.pack,
    records: translation.records.length,
    resolved: translation.counts.resolved,
    provisional: translation.counts.provisional,
    unresolved: translation.counts.unresolved,
    vocabularyCandidates: translation.vocabularyCandidates.length,
    executable: database.catalog.executableCount,
    unsupported: database.catalog.unsupportedCount,
    packHash: database.catalog.packHash
  };
  report(JSON.stringify(result, null, 2));
  return { translation, database, result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTranslationDocument().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
