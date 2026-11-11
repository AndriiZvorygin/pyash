import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildProgram } from "../program/program.mjs";
import {
  buildVliwDatabase,
  buildVliwDatabaseFromTranslation,
  queryVliwCatalog,
  readVliwDatabaseFiles,
  replayVliwDatabase,
  writeVliwDatabaseFiles
} from "../program/library/vliw/index.mjs";

const QUERY_FIELDS = new Set([
  "id",
  "status",
  "semantic",
  "verb",
  "mood",
  "case",
  "hnuc",
  "codeletHash",
  "sourceLanguage",
  "sourceLocator",
  "sourceLine",
  "sourceSentence",
  "reads",
  "writes",
  "canonicalIncludes",
  "word",
  "value"
]);

function usageError(message) {
  const error = new Error(`${message}\nusage: node command/pyac_database.mjs <build|build-translation|query|replay> ...`);
  error.code = "invalid-usage";
  return error;
}

function parseQueryValue(field, raw) {
  if (["word", "hnuc", "sourceLine", "sourceSentence"].includes(field)) {
    const value = Number(raw);
    if (!Number.isInteger(value)) throw usageError(`${field} requires an integer value`);
    return value;
  }
  if (field === "value") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function sourceSentences(source) {
  return buildProgram(source).sentences.filter((sentence) => (
    sentence?.mood !== "def" && sentence?.mood !== "prah"
  ));
}

function sourceEntries(sourcePath, sentences) {
  return sentences.map((_, sentenceIndex) => ({
    language: "pyash",
    locator: sourcePath,
    sentenceIndex
  }));
}

function reportBuild(result, paths, sentenceCount) {
  return {
    command: "build",
    source: paths.sourcePath,
    catalog: paths.catalogPath,
    pack: paths.packPath,
    sentenceCount,
    recordCount: result.catalog.recordCount,
    executableCount: result.catalog.executableCount,
    unsupportedCount: result.catalog.unsupportedCount,
    packHash: result.catalog.packHash
  };
}

function reportTranslationBuild(result, paths, language) {
  return {
    command: "build-translation",
    language,
    source: paths.sourcePath,
    catalog: paths.catalogPath,
    pack: paths.packPath,
    sentenceCount: result.sentences.length,
    recordCount: result.catalog.recordCount,
    executableCount: result.catalog.executableCount,
    unsupportedCount: result.catalog.unsupportedCount,
    packHash: result.catalog.packHash
  };
}

async function buildDatabase(args) {
  if (args.length !== 3) throw usageError("build requires source.pya, catalog.pya, and pack.pyac");
  const [sourcePath, catalogPath, packPath] = args.map((value) => resolve(value));
  const source = fs.readFileSync(sourcePath, "utf8");
  const sentences = sourceSentences(source);
  const database = buildVliwDatabase(sentences, {
    sources: sourceEntries(sourcePath, sentences)
  });
  writeVliwDatabaseFiles(database, { catalogPath, packPath });
  return reportBuild(database, { sourcePath, catalogPath, packPath }, sentences.length);
}

async function queryDatabase(args) {
  if (args.length !== 4) throw usageError("query requires catalog.pya, pack.pyac, field, and value");
  const [catalogPath, packPath, field, rawValue] = args;
  if (!QUERY_FIELDS.has(field)) throw usageError(`unsupported query field: ${field}`);
  const database = readVliwDatabaseFiles({
    catalogPath: resolve(catalogPath),
    packPath: resolve(packPath)
  });
  const records = queryVliwCatalog(database.catalog, {
    [field]: parseQueryValue(field, rawValue)
  });
  return {
    command: "query",
    catalog: resolve(catalogPath),
    pack: resolve(packPath),
    field,
    value: parseQueryValue(field, rawValue),
    count: records.length,
    records
  };
}

async function buildTranslationDatabase(args) {
  if (args.length !== 4) {
    throw usageError("build-translation requires language, source text, catalog.pya, and pack.pyac");
  }
  const [language, sourcePath, catalogPath, packPath] = args;
  const paths = {
    sourcePath: resolve(sourcePath),
    catalogPath: resolve(catalogPath),
    packPath: resolve(packPath)
  };
  const source = fs.readFileSync(paths.sourcePath, "utf8");
  const database = buildVliwDatabaseFromTranslation(source.split(/\r?\n/u), {
    language,
    locator: paths.sourcePath
  });
  writeVliwDatabaseFiles(database, paths);
  return reportTranslationBuild(database, paths, language);
}

async function replayDatabase(args) {
  if (args.length < 2) throw usageError("replay requires catalog.pya and pack.pyac");
  const [catalogPath, packPath, ...ids] = args;
  const database = readVliwDatabaseFiles({
    catalogPath: resolve(catalogPath),
    packPath: resolve(packPath)
  });
  const outcomes = await replayVliwDatabase(database, {
    ...(ids.length ? { ids } : {})
  });
  return {
    command: "replay",
    catalog: resolve(catalogPath),
    pack: resolve(packPath),
    count: outcomes.length,
    outcomes
  };
}

export async function runPyacDatabase(args = process.argv.slice(2), { report = () => {} } = {}) {
  const [command, ...rest] = args;
  let result;
  if (command === "build") result = await buildDatabase(rest);
  else if (command === "build-translation") result = await buildTranslationDatabase(rest);
  else if (command === "query") result = await queryDatabase(rest);
  else if (command === "replay") result = await replayDatabase(rest);
  else throw usageError(`unknown command: ${command ?? ""}`.trim());
  report(result);
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPyacDatabase(process.argv.slice(2), {
    report: (result) => process.stdout.write(`${JSON.stringify(result)}\n`)
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
