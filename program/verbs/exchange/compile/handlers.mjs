import { sentenceToPyash } from "../../../beautiful.mjs";
import { throwErrorSentence } from "../../../error.mjs";
import { jsonToPyashText } from "../json_map.mjs";
import { markDeclared, sanitizeName, sentenceIdForText } from "./util.mjs";

function resolveStateValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.wo) return String(value.wo);
  if (value?.text) return String(value.text);
  if (value?.name) return String(value.name);
  return "";
}

export function handleCompileSentence(sentence, { lang, declared, declaredTypes, cHelpers } = {}) {
  if (lang !== "c" && lang !== "javascript") return null;
  const sourceState = resolveStateValue(sentence?.fromstate).toLowerCase();
  const targetState = resolveStateValue(sentence?.tostate ?? sentence?.become).toLowerCase();
  if (sourceState !== "json" || targetState !== "pyash") return null;
  const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "compile error",
      message: "compile: source text is required (from text or from filename)",
      from: { name: "compile" }
    });
  }
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
  let text;
  try {
    text = jsonToPyashText(parsed, sentence?.su?.name ?? "data").text;
  } catch (err) {
    throwErrorSentence({
      name: "compile error",
      message: err?.message ?? "compile: json export failed",
      from: { name: "compile" },
      raw: { error: err?.message }
    });
  }
  const wrappedText = `quoted.pyash.\n${text}.pyash.quoted`;
  const targetName = sentence?.to?.name ?? "output";
  const safeName = sanitizeName(targetName);
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "text");
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
    }
    return `char ${safeName}[PYA_TEXT_CAP] = ${JSON.stringify(wrappedText)};`;
  }
  const sentenceObject = `{ su: { name: "${targetName}" }, ob: { text: ${JSON.stringify(wrappedText)} }, be: "pyash", mood: "ya" }`;
  return `let ${safeName} = ${sentenceObject};\nglobalThis["${targetName}"] = ${safeName};`;
}

export function handleImportSentence(sentence, { lang, declared, declaredTypes, jsHelpers, cHelpers, locals, cState } = {}) {
  cState.evokeCounter = (cState.evokeCounter ?? -1) + 1;
  const sentenceId = sentenceIdForText(sentenceToPyash(sentence), cState.evokeCounter);
  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  if (!targetName) {
    throwErrorSentence({
      name: "import error",
      message: "import: target name is required (to name <map>)",
      from: { name: "compile" },
      raw: sentence
    });
  }
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
  const sourceName = sentence?.ob?.name;
  if (sourceFilename && sourceFilename.endsWith(".pya")) {
    return null;
  }
  if (!sourceFilename && typeof sourceText !== "string" && !sourceName) return null;
  const safeName = sanitizeName(targetName);
  const alreadyDeclared = declared?.has(targetName);
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "text");
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesJsonRuntime = true;
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesCtype = true;
    }
    const lines = [];
    const sourceVar = `${safeName}_source`;
    const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
    if (needsDecl) {
      lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
    }
    lines.push(`char ${sourceVar}[PYA_TEXT_CAP] = "";`);
    if (sourceFilename) {
      if (cHelpers) cHelpers.usesExchange = true;
      lines.push(`if (!pya_read_file_text(${JSON.stringify(sourceFilename)}, ${sourceVar})) { fprintf(stderr, "import: json lost\\n"); }`);
      lines.push(`pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)});`);
    } else if (typeof sourceText === "string") {
      lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
    } else if (sourceName) {
      const sourceVarName = sanitizeName(sourceName);
      lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${sourceVarName});`);
    }
    lines.push(`pya_json_error ${safeName}_err = { "", 0, 0 };`);
    lines.push(`if (!pya_json_to_pyash(${sourceVar}, ${JSON.stringify(targetName)}, ${safeName}, &${safeName}_err)) { fprintf(stderr, "%s\\n", ${safeName}_err.message); }`);
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesJsonRuntime = true;
    jsHelpers.usesVectorFormat = true;
    if (sourceFilename) {
      jsHelpers.usesFs = true;
      jsHelpers.usesExchange = true;
    }
  }
  const sourceExpr = sourceFilename && jsHelpers?.usesExchange
    ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)})`
    : (sourceFilename
      ? `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`
      : JSON.stringify(sourceText));
  const parseVar = `${safeName}_json`;
  const assignLine = alreadyDeclared
    ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`
    : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`;
  return [
    `let ${parseVar};`,
    `try { ${parseVar} = JSON.parse(${sourceExpr}); } catch (err) { throw new Error("import: invalid json"); }`,
    assignLine,
    `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
  ].join("\n");
}

export function handleReadSentence(sentence, { lang, locals, declared, declaredTypes, cHelpers, jsHelpers, cState } = {}) {
  cState.evokeCounter = (cState.evokeCounter ?? -1) + 1;
  const sentenceId = sentenceIdForText(sentenceToPyash(sentence), cState.evokeCounter);
  const sourceState = resolveStateValue(sentence?.fromstate).toLowerCase();
  if (sourceState === "json") {
    const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
    const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
    const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
    if (!sourceFilename && typeof sourceText !== "string") return null;
    const safeName = sanitizeName(targetName);
    const alreadyDeclared = declared?.has(targetName);
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesJsonRuntime = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
        cHelpers.usesCtype = true;
      }
      const lines = [];
      const sourceVar = `${safeName}_source`;
      const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
      if (needsDecl) {
        lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
      }
      lines.push(`char ${sourceVar}[PYA_TEXT_CAP] = "";`);
    if (sourceFilename) {
      if (cHelpers) cHelpers.usesExchange = true;
      lines.push(`if (!pya_read_file_text(${JSON.stringify(sourceFilename)}, ${sourceVar})) { fprintf(stderr, "read: json lost\\n"); }`);
      lines.push(`pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)});`);
    } else if (typeof sourceText === "string") {
      lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
    } else if (sourceName) {
      const sourceVarName = sanitizeName(sourceName);
      lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${sourceVarName});`);
    }
    lines.push(`pya_json_error ${safeName}_err = { "", 0, 0 };`);
    lines.push(`if (!pya_json_to_pyash(${sourceVar}, ${JSON.stringify(targetName)}, ${safeName}, &${safeName}_err)) { fprintf(stderr, "%s\\n", ${safeName}_err.message); }`);
    return lines.join("\n");
  }
    if (jsHelpers) {
      jsHelpers.usesJsonRuntime = true;
      jsHelpers.usesVectorFormat = true;
      if (sourceFilename) {
        jsHelpers.usesFs = true;
        jsHelpers.usesExchange = true;
      }
    }
  const sourceExpr = sourceFilename && jsHelpers?.usesExchange
    ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)})`
    : (sourceFilename
      ? `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`
      : (typeof sourceText === "string"
        ? JSON.stringify(sourceText)
        : (sourceName ? `${sanitizeName(sourceName)}?.ob?.text ?? ${sanitizeName(sourceName)}` : "\"\"")));
    const parseVar = `${safeName}_json`;
    const assignLine = alreadyDeclared
      ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`
      : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: jsonToPyashTextRuntime(${parseVar}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`;
    return [
      `let ${parseVar};`,
      `try { ${parseVar} = JSON.parse(${sourceExpr}); } catch (err) { throw new Error("read: invalid json"); }`,
      assignLine,
      `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
    ].join("\n");
  }
  return null;
}

export const BASE_BE_HANDLERS = new Map([
  ["compile", handleCompileSentence],
  ["import", handleImportSentence],
  ["read", handleReadSentence]
]);
