import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildProgram } from "../../../program.mjs";
import { doRemember, remember } from "../../../remember/index.mjs";
import { throwErrorSentence } from "../../../error.mjs";
import { jsonToPyashText } from "../json_map.mjs";
import { applyDefaultSayMapping, findDefaultSayMapping, findRetryConfig, loadDefaultConfigProgram } from "./default_config.mjs";
import { sentenceLineNumbersFromText, inlineSourceMap } from "./source_map.mjs";
import { expandModulesForCompile } from "./module_imports.mjs";
import { transpileProgram } from "./transpile_program.mjs";

function resolveStateValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.wo) return String(value.wo);
  if (value?.text) return String(value.text);
  if (value?.name) return String(value.name);
  return "";
}

export async function compile_from_filename_to_filename(sentence) {
  const agentCwd = remember("agent cwd")?.ob?.filename ?? null;
  const sandboxActive = remember("agent sandbox")?.ob?.boolean === true;
  const resolveSandboxPath = (filename) => {
    if (!filename || !agentCwd) return filename;
    return path.isAbsolute(filename) ? filename : path.resolve(agentCwd, filename);
  };

  const sourceFilenameRaw =
    sentence?.from?.filename ??
    sentence?.ob?.filename ??
    sentence?.filename;
  const sourceFilename = resolveSandboxPath(sourceFilenameRaw);

  let sourceText = sentence?.fromtext?.text ?? sentence?.from?.text ?? sentence?.text ?? sentence?.ob?.text;

  if (!sourceText && sentence?.ob?.name) {
    const recalled = remember(sentence.ob.name);
    sourceText = recalled?.ob?.text;
  }

  if (!sourceText && sourceFilename) {
    try {
      sourceText = await fs.readFile(sourceFilename, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") {
        throwErrorSentence({
          name: "file or directory unavailable error",
          message: `file or directory unavailable: ${sourceFilename}`,
          from: { name: "compile" }
        });
      }
      throw err;
    }
  }
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "compile error",
      message: "compile: source text is required (from text or from filename)",
      from: { name: "compile" }
    });
  }

  const sourceState = String(
    sentence?.fromstate?.name ??
    sentence?.fromstate?.wo ??
    sentence?.fromstate ??
    ""
  ).toLowerCase();
  if (!sourceState || sourceState === "pyash") {
    sourceText = sourceText.replaceAll("\\n", "\n");
  }
  const targetState = String(
    sentence?.tostate?.name ??
    sentence?.tostate?.wo ??
    sentence?.become?.name ??
    sentence?.become?.wo ??
    "javascript"
  ).toLowerCase();

  if (sourceState === "markdown" && (targetState === "html" || targetState === "pdf")) {
    const targetFilenameRaw = sentence?.to?.filename;
    const targetFilename = resolveSandboxPath(targetFilenameRaw);
    if (!sourceFilename || !targetFilename) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: markdown conversions require from filename and to filename",
        from: { name: "compile" }
      });
    }
    const args = targetState === "html"
      ? ["--from=markdown", "--to=html", "--wrap=none", sourceFilename, "-o", targetFilename]
      : ["--from=markdown", sourceFilename, "-o", targetFilename];
    let res;
    try {
      res = spawnSync("pandoc", args, { stdio: "pipe" });
    } catch (err) {
      if (err?.code === "ENOENT") {
        throwErrorSentence({
          name: "file or directory unavailable error",
          message: "file or directory unavailable: pandoc",
          from: { name: "compile" }
        });
      }
      throw err;
    }
    if (res.error || res.status !== 0) {
      const stderr = res.stderr ? res.stderr.toString("utf8") : "";
      throwErrorSentence({
        name: "compile error",
        message: `compile: pandoc failed${stderr ? ` (${stderr.trim()})` : ""}`,
        from: { name: "compile" }
      });
    }
    const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.su?.name;
    if (targetState === "html") {
      let htmlText = "";
      try {
        htmlText = await fs.readFile(targetFilename, "utf8");
      } catch (err) {
        if (err?.code === "ENOENT") {
          throwErrorSentence({
            name: "file or directory unavailable error",
            message: `file or directory unavailable: ${targetFilename}`,
            from: { name: "compile" }
          });
        }
        throw err;
      }
      const wrappedText = `quoted.html.\\n${htmlText}.html.quoted`;
      if (targetName) {
        doRemember({
          su: { name: targetName },
          be: "html",
          ob: { text: wrappedText },
          mood: "ya",
        });
      }
      return { ob: { text: wrappedText }, be: "html" };
    }
    if (targetName) {
      doRemember({
        su: { name: targetName },
        be: "pdf",
        ob: { filename: targetFilename },
        mood: "ya",
      });
    }
    return { ob: { filename: targetFilename }, be: "pdf" };
  }
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
  const defaultMapping = findDefaultSayMapping(
    [
      ...configSentences,
      ...program.sentences
    ],
    { baseDir: process.cwd() }
  );
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
    const sourceState = resolveStateValue(s?.fromstate).toLowerCase();
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

  const targetFilenameRaw = sentence?.to?.filename;
  const targetFilename = resolveSandboxPath(targetFilenameRaw);
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
