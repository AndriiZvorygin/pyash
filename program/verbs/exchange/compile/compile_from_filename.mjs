import fs from "node:fs/promises";
import path from "node:path";
import { buildProgram } from "../../../program.mjs";
import { doRemember, remember } from "../../../remember/index.mjs";
import { throwErrorSentence } from "../../../error.mjs";
import { jsonToPyashText } from "../json_map.mjs";
import { applyDefaultSayMapping, findDefaultSayMapping, findRetryConfig, loadDefaultConfigProgram } from "./default_config.mjs";
import { sentenceLineNumbersFromText, inlineSourceMap } from "./source_map.mjs";
import { expandModulesForCompile } from "./module_imports.mjs";
import { transpileProgram } from "./transpile_program.mjs";

export async function compile_from_filename_to_filename(sentence) {
  const sourceFilename =
    sentence?.from?.filename ??
    sentence?.ob?.filename ??
    sentence?.filename;

  let sourceText = sentence?.fromtext?.text ?? sentence?.from?.text ?? sentence?.text ?? sentence?.ob?.text;

  if (!sourceText && sentence?.ob?.name) {
    const recalled = remember(sentence.ob.name);
    sourceText = recalled?.ob?.text;
  }

  if (!sourceText && sourceFilename) {
    sourceText = await fs.readFile(sourceFilename, "utf8");
  }
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "compile error",
      message: "compile: source text is required (from text or from filename)",
      from: { name: "compile" }
    });
  }

  const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
  if (!sourceState || sourceState === "pyash") {
    sourceText = sourceText.replaceAll("\\n", "\n");
  }
  const targetState = (sentence?.tostate?.name || sentence?.become?.name || "javascript").toLowerCase();
  if (sourceState === "json" && targetState === "pyash") {
    let parsed;
    try {
      parsed = JSON.parse(sourceText);
    } catch (err) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: invalid json",
        from: { name: "compile" },
        raw: { error: err?.message }
      });
    }
    const rootName = sentence?.su?.name ?? "data";
    let text;
    try {
      text = jsonToPyashText(parsed, rootName).text;
    } catch (err) {
      throwErrorSentence({
        name: "compile error",
        message: err?.message ?? "compile: json export failed",
        from: { name: "compile" },
        raw: { error: err?.message }
      });
    }
    const wrappedText = `quoted.pyash.\n${text}.pyash.quoted`;
    const targetFilename = sentence?.to?.filename;
    if (targetFilename) {
      await fs.writeFile(targetFilename, text, "utf8");
    }
    const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.su?.name;
    if (targetName) {
      doRemember({
        su: { name: targetName },
        be: "pyash",
        ob: { text: wrappedText },
        mood: "ya",
      });
    }
    return { ob: { text: wrappedText }, be: "pyash" };
  }

  const configProgram = await loadDefaultConfigProgram(process.cwd());
  const program = buildProgram(sourceText);
  const configSentences = configProgram?.sentences ?? [];
  const defaultMapping = findDefaultSayMapping([
    ...configSentences,
    ...program.sentences
  ]);
  const retryConfig = findRetryConfig(configSentences);
  const entrySentences = defaultMapping
    ? applyDefaultSayMapping(program.sentences, defaultMapping)
    : program.sentences;
  const expanded = await expandModulesForCompile(sentence?.from?.filename, entrySentences);
  const sourceLines = sentenceLineNumbersFromText(sourceText);
  const sourceName = sourceFilename ? path.basename(sourceFilename) : "<pyash>";
  const canMap = sourceLines.length === expanded.length;
  const skipCsvInline = targetState === "javascript" || targetState === "js" || targetState === "c";
  for (const s of expanded) {
    const isRead = s?.be === "read";
    const sourceState = (s?.fromstate?.name || s?.fromstate || "").toLowerCase();
    if (!isRead || sourceState !== "csv") continue;
    if (skipCsvInline) continue;
    const filename = s?.from?.filename ?? s?.ob?.filename;
    if (!filename) continue;
    const hasInlineText = typeof s?.ob?.text === "string"
      || typeof s?.from?.text === "string"
      || typeof s?.fromtext?.text === "string";
    if (hasInlineText) continue;
    const fileText = await fs.readFile(filename, "utf8");
    s.ob = { ...(s.ob || {}), text: fileText };
  }

  const targetLang = targetState || "javascript";
  const wantsJsMap = (targetLang === "javascript" || targetLang === "js") && canMap;
  const bodyRaw = transpileProgram(expanded, {
    lang: targetLang,
    sourceLineNumbers: canMap ? sourceLines : null,
    sourceFilename: canMap ? (sourceFilename ?? "<pyash>") : null,
    collectSourceMap: wantsJsMap,
    retryConfig
  });
  const body = wantsJsMap ? inlineSourceMap(bodyRaw, { sourceName, sourceText }) : bodyRaw;
  const wrappedText = `quoted.${targetLang}.\n${body}.${targetLang}.quoted`;

  const targetFilename = sentence?.to?.filename;
  if (targetFilename) {
    await fs.writeFile(targetFilename, body, "utf8");
  }

  const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.su?.name;
  if (targetName) {
    doRemember({
      su: { name: targetName },
      be: sentence?.become?.name ?? "javascript",
      ob: { text: wrappedText, sentences: program.sentences },
      mood: "ya",
    });
  }

  return { ob: { text: wrappedText, sentences: program.sentences }, be: sentence?.become?.name ?? "javascript" };
}
