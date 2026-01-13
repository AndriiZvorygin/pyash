import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { buildProgram } from "../../program.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parseYamlToJsonValue } from "./yaml.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { deriveSignatureFromDefinition, joinSignatureWords } from "../../bridge/signature.mjs";
import { clearModuleCache, loadModule, setEntryModulePath } from "../../bridge/modules.mjs";
import { vectorFormatHelper } from "./helpers_js.mjs";
import { TEXT_HELPER, VECTOR_PRINT_HELPER, VECTOR_TYPE_DECL, MAP_TYPE_DECL, MAP_HELPER, JSON_PYASH_HELPER, CSV_RUNTIME_HELPER, YAML_STRINGIFY_HELPER, YAML_RUNTIME_HELPER, EXCHANGE_HELPER, MIND_RUNTIME_HELPER, COMMAND_HELPER } from "./compile/c/helpers_c.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { jsonToPyashText, mapSentenceToPyash } from "./json_map.mjs";
import { CJSON_HEADER, CJSON_SOURCE, CSV_PARSE_RUNTIME_URL, YAML_RUNTIME_URL } from "./compile/constants.mjs";
import { applyDefaultSayMapping, findDefaultSayMapping, findRetryConfig, loadDefaultConfigProgram } from "./compile/default_config.mjs";
import { handleCeremonyDefinition } from "./compile/emit_ceremony_def.mjs";
import { handleCommandSentence } from "./compile/emit_command.mjs";
import { handleDoSentence } from "./compile/emit_loop.mjs";
import { handleMindSentence } from "./compile/emit_mind.mjs";
import { handleMapEnumeration } from "./compile/emit_map.mjs";
import { handleMapDefinition } from "./compile/emit_map_def.mjs";
import { handleMathSentence } from "./compile/emit_math.mjs";
import { handleReadSentence } from "./compile/emit_read.mjs";
import { handleSayOrWrite } from "./compile/emit_write.mjs";
import { handleVectorElementOps } from "./compile/emit_vector.mjs";
import { BASE_BE_HANDLERS } from "./compile/handlers.mjs";
import { indexExprFromAt } from "./compile/index_helpers.mjs";
import { csvTextFromMapSentence, jsonFromMapSentence, mapDefChainFromName, normalizeJsonMapError } from "./compile/map_helpers.mjs";
import { mindHelperSource, mindHistorySource } from "./compile/js/mind_runtime_helper.mjs";
import { mindToolHelperSource } from "./compile/js/mind_tool_helper.mjs";
import { canonicalJsonStringify, canonicalizeJsonValue, parseCsvText } from "./compile/parse_helpers.mjs";
import { csvRuntimeHelper, exchangeRuntimeHelper, jsonRuntimeHelper, newspaperRuntimeHelper, yamlRuntimeHelper, yamlStringifyHelper } from "./compile/js/runtime_helpers.mjs";
import { buildToolSchemasForCompile } from "./compile/tooling.mjs";
import { compareUtf8, markDeclared, sanitizeName, sentenceIdForText } from "./compile/util.mjs";
import { resolveVerbAlias } from "../../library/verbAliases.mjs";

function sentenceLineNumbersFromText(sourceText) {
  const sentences = splitSentences(sourceText);
  const lines = [];
  let searchIndex = 0;
  let fallbackLine = 1;
  for (const sentence of sentences) {
    const pos = sourceText.indexOf(sentence, searchIndex);
    if (pos === -1) {
      lines.push(fallbackLine);
      continue;
    }
    const line = sourceText.slice(0, pos).split("\n").length;
    lines.push(line);
    fallbackLine = line;
    searchIndex = pos + sentence.length;
  }
  return lines;
}

const SOURCE_MAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value) {
  let vlq = value < 0 ? ((-value) << 1) + 1 : (value << 1);
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += SOURCE_MAP_CHARS[digit];
  } while (vlq > 0);
  return out;
}

function buildSourceMappings(lineMappings = []) {
  let prevSourceLine = 0;
  let mappings = "";
  for (let i = 0; i < lineMappings.length; i += 1) {
    if (i > 0) mappings += ";";
    const sourceLine = lineMappings[i];
    if (sourceLine == null) continue;
    const sourceLineZero = Math.max(0, Number(sourceLine) - 1);
    const seg = encodeVlq(0) + encodeVlq(0) + encodeVlq(sourceLineZero - prevSourceLine) + encodeVlq(0);
    mappings += seg;
    prevSourceLine = sourceLineZero;
  }
  return mappings;
}

function inlineSourceMap(code, { sourceName, sourceText } = {}) {
  const lines = String(code).split("\n");
  const output = [];
  const mappings = [];
  let currentSourceLine = null;
  for (const line of lines) {
    const match = line.match(/^\/\/ @pyash-line (\d+)\s*$/);
    if (match) {
      currentSourceLine = Number(match[1]) || null;
      continue;
    }
    output.push(line);
    mappings.push(currentSourceLine);
  }
  const map = {
    version: 3,
    file: sourceName ?? "",
    sources: [sourceName ?? "<pyash>"],
    sourcesContent: sourceText ? [sourceText] : [],
    names: [],
    mappings: buildSourceMappings(mappings)
  };
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
  output.push(`//# sourceMappingURL=data:application/json;base64,${encoded}`);
  return output.join("\n");
}

function handleRetSentence(sentence, { lang, sentenceArg, locals, declared } = {}) {
  if (sentence.mood !== "ret") return null;
  const sourceName = sentence?.ret?.name || sentence?.ob?.name || sentence?.su?.name;
  if (sourceName) {
    return `return ${sanitizeName(sourceName)};`;
  }
  if (sentence.ob?.genitive && sentenceArg) {
    const expr = pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared, allowCGlobals: lang === "c" });
    if (expr) return `return ${expr};`;
  }
  if (sentence.ob?.num !== undefined) return `return ${Number(sentence.ob.num) || 0};`;
  if (typeof sentence.ob?.text === "string") return `return ${JSON.stringify(sentence.ob.text)};`;
  return lang === "c" ? "return;" : "return sentence;";
}


function pathFromGenitive(genitive = [], sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals = false } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  if (!sentenceArg) {
    if (!allowCGlobals) return null;
    // C ceremonies/loops currently use global loop registers instead of passing a sentence object.
    // Allow the common loop-register genitives (this/fromindex/etc) to resolve to those globals.
    // Supported: `this ti fromindex`, `fromindex num of this`, etc.
    const rootName = typeof chainArr[0] === "string" ? sanitizeName(chainArr[0]) : null;
    if (rootName && (locals?.has(rootName) || declared?.has(rootName))) {
      const rest = chainArr.slice(1);
      if (rest.length === 0) return rootName;
      if (rest.length === 1 && rest[0] === "num") return rootName;
      if (rest.length === 2 && rest[0] === "ob" && (rest[1] === "num" || rest[1] === "text" || rest[1] === "boolean")) return rootName;
      return [rootName, ...rest.map(part => `.${part}`)].join("");
    }
    const isThisPrefix = chainArr[0] === "this";
    const isThisSuffix = chainArr[chainArr.length - 1] === "this";
    const parts = isThisPrefix ? chainArr.slice(1) : (isThisSuffix ? chainArr.slice(0, -1) : null);
    if (parts && parts.length) {
      const head = parts[0];
      if (parts.length === 2 && parts[0] === "ob") {
        if (parts[1] === "text") return "pya_ob_text";
        if (parts[1] === "num") return "pya_ob_num";
        if (parts[1] === "boolean") return "pya_ob_bool";
      }
      if (head === "by") {
        if (parts.length === 1) return "by";
        if (parts.length === 2 && parts[1] === "num") return "by";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "by";
      }
      if (head === "from") {
        if (parts.length === 1) return "pya_from_num";
        if (parts.length === 2 && parts[1] === "num") return "pya_from_num";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "pya_from_num";
      }
      if (parts.length === 1 && ["fromindex", "toindex", "atindex"].includes(head)) return head;
      if (parts.length === 2 && parts[1] === "num" && ["fromindex", "toindex", "atindex"].includes(head)) return head;
    }
    return null;
  }
  const isLocalRoot = chainArr[0] !== "this" && typeof chainArr[0] === "string" && (locals?.has(sanitizeName(chainArr[0])) || declared?.has(sanitizeName(chainArr[0])));
  const chain = chainArr[0] === "this" ? chainArr.slice(1) : chainArr;
  if (chain.length === 0) return sentenceArg;
  if (chain.length === 0) return sentenceArg;
  if (chain.length === 2 && chain[1] === "num" && ["fromindex", "toindex", "atindex", "by"].includes(chain[0])) {
    return `${sentenceArg}.${chain[0]}?.num ?? ${sentenceArg}.${chain[0]}`;
  }
  if (isLocalRoot) {
    const [root, ...rest] = chain;
    if (localsTypes?.get(sanitizeName(root)) === "number") {
      if (rest.length === 1 && rest[0] === "num") return sanitizeName(root);
      if (rest.length === 2 && rest[0] === "ob" && rest[1] === "num") {
        const base = sanitizeName(root);
        return `${base}.ob?.num ?? ${base}`;
      }
    }
    return [sanitizeName(root), ...rest.map(part => `.${part}`)].join("");
  }
  return [sentenceArg, ...chain.map(part => `.${part}`)].join("");
}

function valueForRole(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    const access = pathFromGenitive(slot.genitive, sentenceArg, { allowCGlobals: true });
    return access;
  }
  return `${sentenceArg}.${role}?.${field} ?? ${sentenceArg}.${role}`;
}

function targetPath(role, sentenceArg, field = "num", slot = {}, { locals, declared } = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    return pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  }
  return `${sentenceArg}.${role}.${field}`;
}

function exprForSlot(slot = {}, { sentenceArg, locals, declared, defaultExpr, field = "num" } = {}) {
  if (!slot) return defaultExpr ?? null;

  if (slot.genitive) {
    const path = pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
    if (path) return path;
  }

  if (slot.thisRef && sentenceArg) {
    return valueForRole(slot.thisRef, sentenceArg, field, slot);
  }

  if (slot.at && slot.name) {
    const baseName = sanitizeName(slot.name);
    const vecRef = locals?.has(baseName) || declared?.has(baseName) ? baseName : JSON.stringify(slot.name);
    const idxVal = Number(slot.at.num ?? slot.at);
    const idxExpr = Number.isNaN(idxVal) ? (slot.at?.num ?? slot.at ?? 0) : idxVal;
    return `${vecRef}.ob?.ve?.values?.[${idxExpr}]`;
  }

  if (field === "text" && typeof slot.wo === "string") {
    return JSON.stringify(slot.wo);
  }

  if (field === "text" && typeof slot.text === "string") {
    return JSON.stringify(slot.text);
  }

  if (slot[field] !== undefined) {
    const n = Number(slot[field]);
    return Number.isNaN(n) ? 0 : n;
  }

  if (typeof slot.text === "string") {
    return JSON.stringify(slot.text);
  }

  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (locals?.has(name)) {
      if (field === "text") return `${name}.ob?.text`;
      if (field === "name") return `${name}.ob?.name`;
      if (field === "num") return `${name}.ob?.num ?? ${name}`;
      return `${name}.ob?.${field} ?? ${name}`;
    }
    if (declared?.has(name)) {
      if (field === "text") return `${name}.ob?.text`;
      if (field === "name") return `${name}.ob?.name`;
      return `${name}.ob?.${field}`;
    }
    return name;
  }

  return defaultExpr ?? null;
}

function lvalueForName(name, { declared, locals, field = "num" } = {}) {
  const clean = sanitizeName(name);
  if (locals?.has(clean)) return clean;
  if (declared?.has(clean)) return `${clean}.ob.${field}`;
  return clean;
}

function vectorValuesExpr(slot = {}, { sentenceArg, locals, declared } = {}) {
  if (!slot) return "[]";
  if (slot.ve?.values) {
    const vals = slot.ve.values.map(v =>
      typeof v === "number" ? v : JSON.stringify(v)
    );
    return `[${vals.join(", ")}]`;
  }
  if (slot.genitive) {
    const path = pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
    if (path) return `${path}?.ve?.values ?? []`;
  }
  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}?.ob?.ve?.values ?? ${name}?.ve?.values ?? []`;
    }
    return "[]";
  }
  return "[]";
}

function vectorExprFromGenitive(genitive, sentenceArg, { locals, declared } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  const [root, tail] = chainArr;
  if (chainArr.length === 2 && tail === "ve") {
    if (root === "this") {
      return sentenceArg ? `${sentenceArg}.ob?.ve ?? ${sentenceArg}.ve` : null;
    }
    const name = sanitizeName(root);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}.ob?.ve ?? ${name}.ve`;
    }
    return `remember(${JSON.stringify(root)})?.ob?.ve`;
  }
  const path = pathFromGenitive(genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  return path;
}

function cExpr(expr) {
  return String(expr ?? "0")
    .replace(/\?\./g, ".")
    .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
    .replace(/\s*\?\?\s*[^)]+/g, "");
}

function transpileSentence(sentence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs } = {}) {
  const ob = sentence.ob ?? {};
  const verb = sentence.be || sentence.mood || "";
  const beWords = verb.split(" ").filter(Boolean);
  const isPermanent = beWords[0] === "permanent";
  const baseBeRaw = isPermanent ? beWords.slice(1).join(" ") : verb;
  const aliasBe = resolveVerbAlias(baseBeRaw);
  const baseBe = aliasBe !== baseBeRaw && !ceremonyFns?.has(baseBeRaw) ? aliasBe : baseBeRaw;
  const effectiveBe = baseBe || sentence.mood;

  const handledRet = handleRetSentence(sentence, { lang, sentenceArg, locals, declared });
  if (handledRet) return handledRet;

  const baseHandler = BASE_BE_HANDLERS.get(baseBe);
  if (baseHandler) {
    const handled = baseHandler(sentence, { lang, declared, declaredTypes, jsHelpers, cHelpers, locals, cState });
    if (handled) return handled;
  }

  const readResult = handleReadSentence({
    sentence,
    baseBe,
    lang,
    sentenceArg,
    locals,
    declared,
    declaredTypes,
    jsHelpers,
    cHelpers,
    cState,
    mapDefs
  }, {
    sentenceIdForText,
    sentenceToPyash,
    sanitizeName,
    markDeclared,
    parseYamlToJsonValue,
    canonicalizeJsonValue,
    jsonToPyashText,
    parseCsvText,
    throwErrorSentence,
    csvTextFromMapSentence
  });
  if (readResult) return readResult;

  // Say -> console.log / printf TODO
  const hasWriteIndex =
    baseBe === "write" &&
    (sentence.at?.num != null || sentence.at?.genitive ||
      sentence.ob?.at?.num != null || sentence.ob?.at?.genitive ||
      sentence.to?.at?.num != null || sentence.to?.at?.genitive);

  const sayWriteResult = handleSayOrWrite({
    sentence,
    baseBe,
    hasWriteIndex,
    lang,
    sentenceArg,
    locals,
    localsTypes,
    declared,
    declaredTypes,
    declaredVectorTypes,
    ceremonyFns,
    loopShim,
    mindShim,
    cHelpers,
    rememberFlag,
    jsHelpers,
    cState,
    mapDefs
  }, {
    sentenceIdForText,
    sentenceToPyash,
    sanitizeName,
    markDeclared,
    exprForSlot,
    mapDefChainFromName,
    mapSentenceToPyash,
    csvTextFromMapSentence,
    vectorExprFromGenitive,
    pathFromGenitive,
    transpileSentence
  });
  if (sayWriteResult) return sayWriteResult;

  const commandResult = handleCommandSentence({
    sentence,
    baseBe,
    lang,
    sentenceArg,
    locals,
    declared,
    declaredTypes,
    jsHelpers,
    cHelpers,
    cState
  }, {
    sentenceToPyash,
    sanitizeName,
    markDeclared,
    exprForSlot
  });
  if (commandResult) return commandResult;

  const mapEnumerationResult = handleMapEnumeration({
    sentence,
    baseBe,
    ob,
    lang,
    locals,
    declared,
    declaredTypes,
    declaredVectorTypes,
    cHelpers,
    cState,
    mapDefs
  }, {
    throwErrorSentence,
    jsonFromMapSentence,
    compareUtf8,
    sanitizeName
  });
  if (mapEnumerationResult) return mapEnumerationResult;

  // Vector element read: ob name doors at num 2 be read to name picked do
  if (baseBe === "read" && ob?.name && ((ob.at?.num != null || ob.at?.genitive) || (sentence.at?.num != null || sentence.at?.genitive)) && (sentence.to?.name || sentenceArg)) {
    const baseName = sanitizeName(ob.name);
    const atSlot = ob.at ?? sentence.at;
    const idxExpr = (() => {
      if (atSlot?.num != null) {
        const idxVal = Number(atSlot.num);
        return Number.isNaN(idxVal) ? atSlot.num : idxVal;
      }
      if (atSlot?.genitive) {
        return pathFromGenitive(atSlot.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: lang === "c" });
      }
      return null;
    })();
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
    const targetName = sentence.to?.name ?? sentence.su?.name ?? "result";
    const targetVar = sanitizeName(targetName);
    const lines = [];
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesString = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
      }
      const vecType = declaredVectorTypes?.get(ob.name) ?? "num";
      const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar);
      if (vecType === "num") {
        lines.push(needsDecl ? `double ${targetVar} = 0;` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "number");
        lines.push(`${targetVar} = ${baseName}.num_values[(int)(${idxExpr})];`);
      } else if (vecType === "text") {
        lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = "";` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "text");
        lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", ${baseName}.text_values[(int)(${idxExpr})]);`);
      } else {
        lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = "";` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "text");
        lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", (${baseName}.num_values[(int)(${idxExpr})] != 0) ? "truth" : "lie");`);
      }
      return lines.filter(Boolean).join("\n");
    }
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(ob.name)});`);
      locals?.add(baseName);
    }
    const vecType = declaredVectorTypes?.get(ob.name) ?? "num";
    if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
      lines.push(`let ${targetVar} = { su: { name: "${targetName}" }, ob: {}, be: "${vecType === "num" ? "number" : "text"}", mood: "ya" };`);
      locals?.add(targetVar);
    }
    if (localsTypes) localsTypes.set(targetVar, vecType === "num" ? "number" : "text");
    const valVar = jsHelpers ? `_val_${jsHelpers.readCounter++}` : "_val";
    lines.push(`const ${valVar} = ${baseName}?.ob?.ve?.values?.[(${idxExpr})];`);
    if (vecType === "num") {
      lines.push(`${targetVar}.ob.num = ${valVar};`);
    } else {
      lines.push(`const _text = (${valVar} === true || ${valVar} === 1) ? "truth" : (${valVar} === false || ${valVar} === 0) ? "lie" : String(${valVar} ?? "");`);
      lines.push(`${targetVar}.ob.text = _text;`);
    }
    return lines.join("\n");
  }

	  // Map/foreach over vector: at all (ceremony or primitive verbs)
	  if (sentence.at?.name === "all" && lang === "c") {
      const fn = ceremonyFns?.get(baseBe);
      const vecName = sentence.ob?.name;
      if (!fn || !vecName) {
        return `/* TODO: ${JSON.stringify(sentence)} */`;
      }
      cHelpers.usesMapGlobals = true;
      const vecVar = sanitizeName(vecName);
      const vecType = declaredVectorTypes?.get(vecName) ?? "num";
      const lines = [];
      lines.push(`for (int i = 0; i < ${vecVar}.length; i++) {`);
      lines.push(`  atindex = i;`);
      if (vecType === "text") {
        lines.push(`  pya_ob_text = ${vecVar}.text_values[i];`);
      } else if (vecType === "bool" || vecType === "boolean") {
        lines.push(`  pya_ob_bool = ${vecVar}.num_values[i] != 0;`);
      } else {
        lines.push(`  pya_ob_num = ${vecVar}.num_values[i];`);
      }
      lines.push(`  ${fn}();`);
      lines.push(`}`);
      return lines.join("\n");
    }
	  if (sentence.at?.name === "all" && lang !== "c") {
	    if (ceremonyFns?.get(baseBe)) {
	      const fn = ceremonyFns.get(baseBe);
	      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
	      const literal = inlineSentenceLiteral(sentence, inlineSet);
	      if (sentenceArg && sentence.by?.genitive?.chain?.[0] === "this") {
	        const byExpr = pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared }) ?? "0";
	        return `{\n  const _ev = ${literal};\n  _ev.by = { num: (${byExpr} ?? 0) };\n  runAtAll(_ev, ${fn});\n}`;
	      }
	      return `runAtAll(${literal}, ${fn});`;
	    }
	    if (baseBe === "plus" || baseBe === "subtract" || baseBe === "invert") {
	      if (sentenceArg) return `// TODO: ${JSON.stringify(sentence)}`;
	      const vecName = sentence.ob?.name;
	      const toName = sentence.to?.name;
	      const delta = Number(sentence.from?.num ?? sentence.ob?.num ?? 0);
	      const op = baseBe === "invert" ? "invert" : baseBe;
      const opBody =
        baseBe === "invert"
          ? `let val = elem;\n    if (typeof val === "number") return val * -1;\n    if (val === "truth" || val === true) return "lie";\n    if (val === "lie" || val === false) return "truth";\n    return val;`
          : baseBe === "plus"
            ? `return (Number(elem) || 0) + ${Number.isNaN(delta) ? 0 : delta};`
            : `return (Number(elem) || 0) - ${Number.isNaN(delta) ? 0 : delta};`;
      const lines = [];
      lines.push(`{`);
      lines.push(`let vecFact = remember(${JSON.stringify(vecName ?? sentence.ob ?? "vec")}) || (typeof ${sanitizeName(vecName ?? "vec")} !== "undefined" ? ${sanitizeName(vecName ?? "vec")} : undefined);`);
      lines.push(`const values = vecFact?.ob?.ve?.values ?? vecFact?.ve?.values ?? [];`);
      lines.push(`const outVals = values.map((elem, i) => {`);
      lines.push(opBody.split("\n").map(l => `  ${l}`).join("\n"));
      lines.push(`});`);
      if (toName) {
        lines.push(`const fact = { su: { name: ${JSON.stringify(toName)} }, ob: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`globalThis[${JSON.stringify(toName)}] = fact;`);
        lines.push(`if (typeof ${sanitizeName(toName)} !== "undefined") { ${sanitizeName(toName)} = fact; }`);
        lines.push(`/* end map */`);
      } else if (vecName) {
        lines.push(`if (vecFact?.ob?.ve) { vecFact.ob.ve.values = outVals; }`);
        lines.push(`const fallback = { su: { name: ${JSON.stringify(vecName)} }, ob: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`const finalFact = vecFact || fallback;`);
        lines.push(`globalThis[${JSON.stringify(vecName)}] = finalFact;`);
        lines.push(`if (typeof ${sanitizeName(vecName)} !== "undefined") { ${sanitizeName(vecName)} = finalFact; }`);
        lines.push(`/* end map */`);
      } else {
        lines.push(`const fact = { ob: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`/* end map */`);
      }
      lines.push(`}`);
      if (rememberFlag) rememberFlag.used = true;
      return lines.join("\n");
    }
  }

  const vectorElementResult = handleVectorElementOps({
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    declared,
    localsTypes,
    declaredTypes,
    cHelpers
  }, {
    sanitizeName,
    exprForSlot,
    indexExprFromAt,
    pathFromGenitive
  });
  if (vectorElementResult) return vectorElementResult;

  const mindResult = handleMindSentence({
    sentence,
    baseBe,
    lang,
    ob,
    declaredTypes,
    jsHelpers,
    cHelpers,
    cState,
    mapDefs,
    mindShim,
    rememberFlag
  }, {
    buildToolSchemasForCompile,
    compareUtf8,
    sanitizeName,
    sentenceToPyash
  });
  if (mindResult) return mindResult;

  if (baseBe === "remember" && sentenceArg) {
    const genitiveChain = sentence.ob?.genitive?.chain || [];
    const genitiveHint = genitiveChain.filter(part => part !== "this").at(-1);
    const rawName = sentence.to?.name?.split(" ")[0] || genitiveHint || "remembered";
    const targetVar = sanitizeName(rawName) || "remembered";
    const source = sentence.ob?.genitive
      ? pathFromGenitive(sentence.ob.genitive, sentenceArg) || `${sentenceArg}.ob`
      : `${sentenceArg}.to`;
    const lines = [];
    if (sentence.exists || sentence.to?.name) {
      lines.push(`let ${targetVar};`);
    }
    lines.push(`${targetVar} = remember(${source});`);
    locals?.add(targetVar);
    return lines.join("\n");
  }

  const mathResult = handleMathSentence({
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    localsTypes,
    declared,
    declaredTypes,
    declaredVectorTypes,
    loopShim,
    mindShim,
    cHelpers,
    rememberFlag,
    jsHelpers,
    cState,
    mapDefs
  }, {
    exprForSlot,
    sanitizeName,
    targetPath,
    transpileSentence,
    vectorValuesExpr,
    lvalueForName,
    pathFromGenitive,
    cExpr
  });
  if (mathResult) return mathResult;

  const name = sentence?.su?.name;
  const mood = sentence?.mood;
  const doResult = handleDoSentence({
    sentence,
    baseBe,
    lang,
    sentenceArg,
    ceremonyFns,
    loopShim,
    cHelpers,
    cState,
    declared,
    locals
  }, {
    inlineSentenceLiteral,
    sanitizeName,
    pathFromGenitive,
    markDeclared
  });
  if (doResult) return doResult;
  if (!name || mood === "do") return null;

  const shouldDeclare = Boolean(sentence.exists);

  if (effectiveBe === "vector" && ob.ve?.values) {
    const fillCountExpr = (() => {
      if (typeof sentence.by?.num === "number") return String(Math.trunc(sentence.by.num));
      if (sentence.by?.name) {
        const base = sanitizeName(sentence.by.name);
        if (declared?.has(base) || locals?.has(base)) return `(${base}?.ob?.num ?? 0)`;
      }
      if (sentence.by?.genitive && !sentenceArg) {
        const chain = sentence.by.genitive.chain || [];
        const root = chain[0];
        if (typeof root === "string") {
          const base = sanitizeName(root);
          if (declared?.has(base) || locals?.has(base)) {
            const path = pathFromGenitive(sentence.by.genitive, "IGNORED", { locals, declared });
            // pathFromGenitive can't run without a real sentence arg; handle the common "num of ob of X" case.
            if (chain.length === 3 && chain[1] === "ob" && chain[2] === "num") return `(${base}?.ob?.num ?? 0)`;
          }
        }
      }
      return null;
    })();

    const rawType = ob.ve.type || "num";
    const vecType = rawType === "number" ? "num" : rawType;
    if (fillCountExpr && ob.ve.values.length === 1) {
      const elem = ob.ve.values[0];
      const elemLiteral = typeof elem === "number" ? String(elem) : JSON.stringify(elem);
      const vecLiteral = `{ type: "${vecType}", values: Array(${fillCountExpr}).fill(${elemLiteral}) }`;
      if (sentenceArg) {
        const target = valueForRole("su", sentenceArg, "ve", sentence.su) ?? name;
        return `${target} = ${vecLiteral};`;
      }
      const sentenceObject = `{ su: { name: "${name}" }, ob: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
      if (lang === "c") {
        const isLiteralCount = /^\d+$/.test(String(fillCountExpr));
        if (!isLiteralCount) return `/* TODO: vector fill with dynamic count in C */`;
        const count = Number(fillCountExpr);
        const suffix = cState ? cState.vectorCounter++ : 0;
        if (cHelpers) {
          cHelpers.usesVectorType = true;
          cHelpers.usesVectorPrinter = true;
          cHelpers.usesString = true;
          cHelpers.usesCtype = true;
        }
        if (vecType === "bool") {
          const val = elem === "truth" || elem === true || elem === 1 ? 1 : 0;
          const values = Array(count).fill(val).join(", ");
          if (shouldDeclare) {
            return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "bool", ${count}, ${name}_values, NULL };`;
          }
          return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "bool", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
        }
        if (vecType === "text") {
          const val = JSON.stringify(String(elem));
          const values = Array(count).fill(val).join(", ");
          if (shouldDeclare) {
            return `const char *${name}_values[] = { ${values} };\npya_vec ${name} = { "text", ${count}, NULL, ${name}_values };`;
          }
          return `do { const char *${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "text", ${count}, NULL, ${name}_values_${suffix} }; } while(0);`;
        }
        if (vecType !== "num") return `/* TODO: vector support in C for ${vecType} */`;
        const numVal = typeof elem === "number" ? elem : Number(elem) || 0;
        const values = Array(count).fill(numVal).join(", ");
        if (shouldDeclare) {
          return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "num", ${count}, ${name}_values, NULL };`;
        }
        return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "num", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
      }
      return shouldDeclare
        ? `${shouldDeclare ? "let" : ""} ${sanitizeName(name)} = ${sentenceObject};\nglobalThis[${JSON.stringify(name)}] = ${sanitizeName(name)};`
        : sentenceObject;
    }

    const values = ob.ve.values
      .map(v => (typeof v === "number" ? v : JSON.stringify(v)))
      .join(", ");
    const vecLiteral = `{ type: "${vecType}", values: [${values}] }`;
    if (sentenceArg) {
      const target = valueForRole("su", sentenceArg, "ve", sentence.su) ?? name;
      return `${target} = ${vecLiteral};`;
    }
    const sentenceObject = `{ su: { name: "${name}" }, ob: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      const suffix = cState ? cState.vectorCounter++ : 0;
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      const cName = sanitizeName(name);
      const count = ob.ve.values.length;
      if (vecType === "text") {
        const values = ob.ve.values.map(v => JSON.stringify(String(v))).join(", ");
        if (shouldDeclare) {
          return `const char *${cName}_values[] = { ${values} };\npya_vec ${cName} = { "text", ${count}, NULL, ${cName}_values };`;
        }
        return `do { const char *${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ "text", ${count}, NULL, ${cName}_values_${suffix} }; } while(0);`;
      }
      if (vecType === "bool") {
        const values = ob.ve.values
          .map(v => (v === "truth" || v === true || v === 1 ? 1 : 0))
          .join(", ");
        if (shouldDeclare) {
          return `double ${cName}_values[] = { ${values} };\npya_vec ${cName} = { "bool", ${count}, ${cName}_values, NULL };`;
        }
        return `do { double ${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ "bool", ${count}, ${cName}_values_${suffix}, NULL }; } while(0);`;
      }
      if (vecType !== "num") {
        return `/* TODO: vector support in C for ${vecType} */`;
      }
      const values = ob.ve.values
        .map(v => (typeof v === "number" ? v : Number(v) || 0))
        .join(", ");
      if (shouldDeclare) {
        return `double ${cName}_values[] = { ${values} };\npya_vec ${cName} = { "num", ${count}, ${cName}_values, NULL };`;
      }
      return `do { double ${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ "num", ${count}, ${cName}_values_${suffix}, NULL }; } while(0);`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `let ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
  }

  if (effectiveBe === "number") {
    const rhsExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    if (sentenceArg && rhsExpr !== null) {
      const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
      if (baseName) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) {
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "number");
          if (ob?.thisRef === "ob") {
            return `let ${baseName} = { su: { name: "${sentence.su.name}" }, ob: {}, be: "number", mood: "ya" };\n${baseName}.ob = ${sentenceArg}.ob;`;
          }
          return `let ${baseName} = { su: { name: "${sentence.su.name}" }, ob: {}, be: "number", mood: "ya" };\n${baseName}.ob.num = ${rhsExpr};`;
        }
        if (localsTypes) localsTypes.set(baseName, "number");
        if (ob?.thisRef === "ob") {
          return `${baseName}.ob = ${sentenceArg}.ob;`;
        }
        return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.num = ${rhsExpr};`;
      }
      const target = valueForRole("su", sentenceArg, "num", sentence.su) ?? `${sentenceArg}.ob?.num`;
      return `${target} = ${rhsExpr};`;
    }

    if (lang === "c" && !sentenceArg && sentence.su?.name) {
      const baseName = sanitizeName(sentence.su.name);
      const fromRef = ob?.thisRef ? ob.thisRef : null;
      const rhs = rhsExpr ?? fromRef ?? (typeof ob.num !== "undefined" ? ob.num : null);
      if (rhs !== null) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) locals?.add(baseName);
        return needsDecl ? `double ${baseName} = ${rhs};` : `${baseName} = ${rhs};`;
      }
    }

    if (typeof ob.num !== "undefined") {
      const value = typeof ob.num === "number" ? ob.num : Number(ob.num);
      const safeValue = Number.isNaN(value) ? 0 : value;
      const sentenceObject = `{ su: { name: "${name}" }, ob: { num: ${safeValue} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
      const decl = shouldDeclare ? (lang === "c" ? "/* TODO: sentence object in C */" : (isPermanent ? "const" : "let")) : "";
      if (lang === "c") {
        // Fallback for C for now: keep scalar style
        const cName = sanitizeName(name);
        if (shouldDeclare) {
          locals?.add(cName);
          if (localsTypes) localsTypes.set(cName, "number");
        }
        if (!shouldDeclare) return `${cName} = ${safeValue};`;
        const cdecl = isPermanent ? "const double" : "double";
        return `${cdecl} ${cName} = ${safeValue};`;
      }
      const varName = sanitizeName(name);
      if (shouldDeclare) {
        return `${decl} ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
      }
      return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
  }

  if (effectiveBe === "text" && typeof ob.text === "string") {
    const value = JSON.stringify(ob.text);
    if (sentenceArg) {
      const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
      if (baseName) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) {
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "text");
          return `let ${baseName} = { su: { name: "${sentence.su.name}" }, ob: {}, be: "text", mood: "ya" };\n${baseName}.ob.text = ${value};`;
        }
        if (localsTypes) localsTypes.set(baseName, "text");
        return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.text = ${value};`;
      }
      const target = valueForRole("su", sentenceArg, "text") ?? name;
      return `${target} = ${value};`;
    }
    const sentenceObject = `{ su: { name: "${name}" }, ob: { text: ${value} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      // Fallback for C: keep scalar style
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesPrintf = true;
      }
      const cName = sanitizeName(name);
      if (shouldDeclare) {
        locals?.add(cName);
        if (localsTypes) localsTypes.set(cName, "text");
      }
      if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, "%s", ${value});`;
      return `char ${cName}[PYA_TEXT_CAP] = ${value};`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `let ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
  }

  if (ob?.la && name) {
    const laLiteral = inlineSentenceLiteral(ob.la, declared);
    const sentenceObject = `{ su: { name: "${name}" }, ob: { la: ${laLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
      }
      const cName = sanitizeName(name);
      const pyash = sentenceToPyash(sentence);
      const literal = JSON.stringify(pyash);
      if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, "%s", ${literal});`;
      return `char ${cName}[PYA_TEXT_CAP] = ${literal};`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `let ${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis["${name}"] = ${varName};`;
  }

  return null;
}


function transpileProgram(sentences, { lang, sourceLineNumbers, sourceFilename, collectSourceMap, retryConfig } = {}) {
  const header =
    lang === "c"
      ? "/* Generated by Pyash compile */"
      : "// Generated by Pyash compile";
  let lines = [header];
  const sourceLines = Array.isArray(sourceLineNumbers) ? sourceLineNumbers : [];
  const sourceLineFor = (idx) => sourceLines[idx] ?? null;
  const mainLines = [];
  let usesRememberShim = false;
  let usesMapShim = false;
  const rememberFlag = { used: false };
  const cHelpers = { usesPrintf: false, usesVectorType: false, usesVectorPrinter: false, usesString: false, usesCtype: false, usesStdlib: false, usesTextHelper: false, usesMap: false, usesMapPrinter: false, usesMapGlobals: false, usesJsonRuntime: false, usesYamlRuntime: false, usesYamlStringify: false, usesCsvRuntime: false, usesExchange: false, usesMindRuntime: false, usesCommand: false };
  const loopShim = { used: false };
  const mindShim = { used: false };
    const jsHelpers = { usesVectorFormat: false, usesJsonMap: false, usesCsvMap: false, usesJsonRuntime: false, usesCsvRuntime: false, usesYamlRuntime: false, usesYamlStringify: false, usesFs: false, usesExchange: false, usesCommand: false, readCounter: 0 };
  const cState = { vectorCounter: 0, csvCounter: 0, fileCounter: 0, jsonMapStrings: new Map(), jsonMapPrettyStrings: new Map(), yamlMapStrings: new Map(), csvMapStrings: new Map(), preMain: [] };
  const mapDefs = new Map();
  const refineryDefs = new Map();
  const declared = new Set();
  const declaredTypes = new Map();
  const ceremonyFns = new Map();
  const declaredVectorTypes = new Map();
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const name = sentence?.su?.name;

    if (sentence.mood === "def" && sentence.be === "refinery") {
      if (!name) {
        throwErrorSentence({
          name: "refinery defective",
          message: "refinery name required",
          from: { name: "compile" },
          raw: sentence
        });
      }
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const platforms = [];
      const seen = new Set();
      for (const entry of body) {
        if (entry?.mood !== "ya" || entry?.be !== "platform") {
          throwErrorSentence({
            name: "platform defective",
            message: "platform declaration must be be platform ya",
            from: { name: "compile" },
            raw: entry
          });
        }
        const platformName = entry?.su?.name;
        if (!platformName) {
          throwErrorSentence({
            name: "platform defective",
            message: "platform name required",
            from: { name: "compile" },
            raw: entry
          });
        }
        if (seen.has(platformName)) {
          throwErrorSentence({
            name: "platform defective",
            message: `platform name duplicated: ${platformName}`,
            from: { name: "compile" },
            raw: entry
          });
        }
        seen.add(platformName);
        let deps = [];
        if (entry.from) {
          if (!entry.from?.ve || entry.from.ve.type !== "name" || !Array.isArray(entry.from.ve.values)) {
            throwErrorSentence({
              name: "depend defective",
              message: "depend list must be from ve name ...",
              from: { name: "compile" },
              raw: entry.from
            });
          }
          deps = entry.from.ve.values.map((value) => String(value));
        }
        const ob = entry?.ob;
        if (!ob || typeof ob !== "object" || !("la" in ob)) {
          throwErrorSentence({
            name: "platform defective",
            message: "platform activity must be ob la ... ko",
            from: { name: "compile" },
            raw: entry
          });
        }
        const extraKeys = Object.keys(ob).filter((key) => key !== "la");
        if (extraKeys.length > 0) {
          throwErrorSentence({
            name: "platform defective",
            message: "platform activity must contain exactly one embedded sentence",
            from: { name: "compile" },
            raw: { extra: extraKeys }
          });
        }
        const clause = ob.la;
        if (!clause || typeof clause !== "object") {
          throwErrorSentence({
            name: "platform defective",
            message: "platform activity must be ob la ... ko",
            from: { name: "compile" },
            raw: clause
          });
        }
        platforms.push({ name: platformName, deps, action: clause });
      }
      refineryDefs.set(name, { name, platforms });
      i = j;
      continue;
    }

    const ceremonyDef = handleCeremonyDefinition({
      sentence,
      sentences,
      index: i,
      lang,
      declared,
      declaredTypes,
      declaredVectorTypes,
      ceremonyFns,
      cHelpers,
      jsHelpers,
      cState
    }, {
      deriveSignatureFromDefinition,
      joinSignatureWords,
      sanitizeName,
      transpileSentence,
      throwErrorSentence
    });
    if (ceremonyDef) {
      if (ceremonyDef.usesRememberShim) {
        usesRememberShim = true;
      }
      if (ceremonyDef.usesMapShim) {
        usesMapShim = true;
        usesRememberShim = true;
      }
      if (collectSourceMap && sourceLineFor(i)) {
        lines.push(`// @pyash-line ${sourceLineFor(i)}`);
      }
      if (lang === "c" && sourceLineFor(i) && sourceFilename) {
        lines.push(`#line ${sourceLineFor(i)} "${sourceFilename}"`);
      }
      lines.push(ceremonyDef.fn);
      i = ceremonyDef.endIndex;
      continue;
    }

    const mapDef = handleMapDefinition({
      sentence,
      sentences,
      index: i,
      name,
      lang,
      collectSourceMap,
      sourceFilename,
      sourceLineFor,
      lines,
      mainLines,
      cHelpers,
      cState,
      mapDefs,
      declared,
      declaredTypes
    }, {
      throwErrorSentence,
      jsonFromMapSentence,
      canonicalJsonStringify,
      canonicalizeJsonValue,
      normalizeJsonMapError,
      csvTextFromMapSentence,
      sanitizeName,
      sentenceToPyash,
      markDeclared
    });
    if (mapDef) {
      i = mapDef.endIndex;
      continue;
    }

    if (sentence.mood === "ya" && name && !sentence.exists && !declared.has(name) && sentence.be !== "export") {
      const pyash = sentenceToPyash(sentence);
      throwErrorSentence({
        name: "variable as not exists",
        message: `su quoted.pyash.${pyash}.pyash.quoted be error ob name variable as not exists ya`,
        from: { name: "compile" },
        pyash,
        raw: sentence
      });
    }

    const line = transpileSentence(sentence, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
    if (typeof line === "string" && line.includes("remember(")) {
      usesRememberShim = true;
    }
    if (rememberFlag.used) {
      usesRememberShim = true;
      rememberFlag.used = false;
    }
    if (typeof line === "string" && line.includes("runAtAll(")) {
      usesMapShim = true;
      usesRememberShim = true;
    }
    const todoPrefix = lang === "c" ? "/* TODO" : "// TODO";
    const todoSuffix = lang === "c" ? " */" : "";
    const target = (() => {
      if (lang === "c" && sentence.mood === "ya") {
        if (typeof line === "string" && (line.startsWith("double ") || line.startsWith("const char") || line.startsWith("char *") || line.startsWith("char ") || line.startsWith("pya_vec "))) {
          return lines; // keep declarations global
        }
      }
      return lang === "c" ? mainLines : lines;
    })();
    const sourceLine = sourceLineFor(i);
    if (collectSourceMap && sourceLine) {
      target.push(`// @pyash-line ${sourceLine}`);
    }
    if (lang === "c" && sourceLine && sourceFilename) {
      target.push(`#line ${sourceLine} "${sourceFilename}"`);
    }
    target.push(line ?? `${todoPrefix}: ${JSON.stringify(sentence)}${todoSuffix}`);
    if (name && sentence.mood === "ya") {
      markDeclared(declared, name);
      if (sentence.be === "text" || sentence.ob?.text !== undefined) {
        declaredTypes.set(name, "text");
      } else if (sentence.be === "number" || sentence.ob?.num !== undefined) {
        declaredTypes.set(name, "number");
      } else if (sentence.ob?.la) {
        declaredTypes.set(name, "sentence");
      } else if (sentence.be === "vector" || sentence.ob?.ve) {
        declaredTypes.set(name, "vector");
        if (sentence.ob?.ve?.type) {
          declaredVectorTypes.set(name, sentence.ob.ve.type);
        }
      }
    }
  }

  const effectiveRetryConfig = {
    initialDelayMs: 250,
    backoff: 2,
    maxAttempts: 5,
    maxDelayMs: 8000,
    ...(retryConfig || {})
  };

  if (refineryDefs.size > 0) {
    if (lang === "c") {
      cHelpers.usesStdlib = true;
      cHelpers.usesString = true;
      cHelpers.usesExchange = true;
      const refineryLines = [];
      refineryLines.push("static void pya_sleep_ms(int ms) {");
      refineryLines.push("  if (ms <= 0) return;");
      refineryLines.push("  struct timespec req;");
      refineryLines.push("  req.tv_sec = ms / 1000;");
      refineryLines.push("  req.tv_nsec = (long)(ms % 1000) * 1000000L;");
      refineryLines.push("  nanosleep(&req, NULL);");
      refineryLines.push("}");
      refineryLines.push("static uint32_t pya_fnv1a_update(uint32_t hash, const unsigned char *data, size_t len) {");
      refineryLines.push("  for (size_t i = 0; i < len; i++) {");
      refineryLines.push("    hash ^= data[i];");
      refineryLines.push("    hash *= 16777619u;");
      refineryLines.push("  }");
      refineryLines.push("  return hash;");
      refineryLines.push("}");
      refineryLines.push("static void pya_fnv1a_hex(const char *text, char *out) {");
      refineryLines.push("  uint32_t hash = 2166136261u;");
      refineryLines.push("  const unsigned char *data = (const unsigned char *)(text ? text : \"\");");
      refineryLines.push("  hash = pya_fnv1a_update(hash, data, strlen((const char *)data));");
      refineryLines.push("  snprintf(out, 16, \"%08x\", hash);");
      refineryLines.push("}");
      refineryLines.push("static void pya_checkpoint_hash(const char *action, const char **depNames, const char **depResults, int depCount, char *out) {");
      refineryLines.push("  uint32_t hash = 2166136261u;");
      refineryLines.push("  const char *prefix = \"action:\";");
      refineryLines.push("  hash = pya_fnv1a_update(hash, (const unsigned char *)prefix, strlen(prefix));");
      refineryLines.push("  hash = pya_fnv1a_update(hash, (const unsigned char *)(action ? action : \"\"), strlen(action ? action : \"\"));");
      refineryLines.push("  for (int i = 0; i < depCount; i++) {");
      refineryLines.push("    const char *dep = depNames[i];");
      refineryLines.push("    const char *res = depResults[i] ? depResults[i] : \"\";");
      refineryLines.push("    const char *sep = \"\\n\";");
      refineryLines.push("    const char *depPrefix = \"dep:\";");
      refineryLines.push("    hash = pya_fnv1a_update(hash, (const unsigned char *)sep, 1);");
      refineryLines.push("    hash = pya_fnv1a_update(hash, (const unsigned char *)depPrefix, strlen(depPrefix));");
      refineryLines.push("    hash = pya_fnv1a_update(hash, (const unsigned char *)(dep ? dep : \"\"), strlen(dep ? dep : \"\"));");
      refineryLines.push("    hash = pya_fnv1a_update(hash, (const unsigned char *)\":\", 1);");
      refineryLines.push("    hash = pya_fnv1a_update(hash, (const unsigned char *)res, strlen(res));");
      refineryLines.push("  }");
      refineryLines.push("  snprintf(out, 16, \"%08x\", hash);");
      refineryLines.push("}");
      refineryLines.push("typedef struct {");
      refineryLines.push("  char refinery[128];");
      refineryLines.push("  char platform[128];");
      refineryLines.push("  char hash[16];");
      refineryLines.push("  char result[PYA_TEXT_CAP];");
      refineryLines.push("} pya_checkpoint_entry;");
      refineryLines.push("static pya_checkpoint_entry pya_checkpoints[256];");
      refineryLines.push("static int pya_checkpoint_count = 0;");
      refineryLines.push("static int pya_checkpoint_loaded = 0;");
      refineryLines.push("static void pya_checkpoint_unescape(const char *src, char *out, size_t cap) {");
      refineryLines.push("  if (!out || cap == 0) return;");
      refineryLines.push("  size_t len = 0;");
      refineryLines.push("  for (const char *p = src ? src : \"\"; *p && len + 1 < cap; p++) {");
      refineryLines.push("    if (*p == '\\\\') {");
      refineryLines.push("      p++;");
      refineryLines.push("      if (!*p) break;");
      refineryLines.push("      if (*p == 't') out[len++] = '\\t';");
      refineryLines.push("      else if (*p == 'n') out[len++] = '\\n';");
      refineryLines.push("      else if (*p == 'r') out[len++] = '\\r';");
      refineryLines.push("      else out[len++] = *p;");
      refineryLines.push("    } else {");
      refineryLines.push("      out[len++] = *p;");
      refineryLines.push("    }");
      refineryLines.push("  }");
      refineryLines.push("  out[len] = '\\0';");
      refineryLines.push("}");
      refineryLines.push("static void pya_load_checkpoints(void) {");
      refineryLines.push("  if (pya_checkpoint_loaded) return;");
      refineryLines.push("  pya_checkpoint_loaded = 1;");
      refineryLines.push("  const char *env = getenv(\"PYA_CHECKPOINTS\");");
      refineryLines.push("  if (!env || !*env) return;");
      refineryLines.push("  const char *p = env;");
      refineryLines.push("  while (*p && pya_checkpoint_count < 256) {");
      refineryLines.push("    char line[PYA_TEXT_CAP];");
      refineryLines.push("    size_t len = 0;");
      refineryLines.push("    while (*p && *p != '\\n' && len + 1 < sizeof(line)) {");
      refineryLines.push("      line[len++] = *p++;");
      refineryLines.push("    }");
      refineryLines.push("    if (*p == '\\n') p++;");
      refineryLines.push("    line[len] = '\\0';");
      refineryLines.push("    if (len == 0) continue;");
      refineryLines.push("    char *fields[4] = { line, NULL, NULL, NULL };");
      refineryLines.push("    int fieldCount = 1;");
      refineryLines.push("    for (size_t i = 0; line[i] && fieldCount < 4; i++) {");
      refineryLines.push("      if (line[i] == '\\t') {");
      refineryLines.push("        line[i] = '\\0';");
      refineryLines.push("        fields[fieldCount++] = line + i + 1;");
      refineryLines.push("      }");
      refineryLines.push("    }");
      refineryLines.push("    if (fieldCount < 4) continue;");
      refineryLines.push("    pya_checkpoint_entry *entry = &pya_checkpoints[pya_checkpoint_count++];");
      refineryLines.push("    pya_checkpoint_unescape(fields[0], entry->refinery, sizeof(entry->refinery));");
      refineryLines.push("    pya_checkpoint_unescape(fields[1], entry->platform, sizeof(entry->platform));");
      refineryLines.push("    pya_checkpoint_unescape(fields[2], entry->hash, sizeof(entry->hash));");
      refineryLines.push("    pya_checkpoint_unescape(fields[3], entry->result, sizeof(entry->result));");
      refineryLines.push("  }");
      refineryLines.push("}");
      refineryLines.push("static const char *pya_find_checkpoint(const char *refinery, const char *platform, const char *hash) {");
      refineryLines.push("  for (int i = 0; i < pya_checkpoint_count; i++) {");
      refineryLines.push("    if (strcmp(pya_checkpoints[i].refinery, refinery) == 0 && strcmp(pya_checkpoints[i].platform, platform) == 0 && strcmp(pya_checkpoints[i].hash, hash) == 0) {");
      refineryLines.push("      return pya_checkpoints[i].result;");
      refineryLines.push("    }");
      refineryLines.push("  }");
      refineryLines.push("  return NULL;");
      refineryLines.push("}");
      for (const [refineryName, refinery] of refineryDefs.entries()) {
        const prefix = sanitizeName(`pya_refinery_${refineryName}`);
        const nameVar = `${prefix}_names`;
        const runVar = `${prefix}_runs`;
        const depsVar = `${prefix}_deps`;
        const depCountVar = `${prefix}_dep_counts`;
        const actionVar = `${prefix}_actions`;
        const depLookup = `${prefix}_find`;
        const runFn = `${prefix}_run`;
        const count = refinery.platforms.length;
        const depArrays = [];
        const runFns = [];
        const names = [];
        const actions = [];
        refinery.platforms.forEach((platform) => {
          const fnName = sanitizeName(`${prefix}_${platform.name}`);
          const actionLine = sentenceToPyash(platform.action);
          const actionEvoke = `ob la ${actionLine} ko be evoke ya`;
          const bodyLine = transpileSentence(platform.action, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
          if (typeof bodyLine === "string" && bodyLine.includes("remember(")) usesRememberShim = true;
          if (rememberFlag.used) {
            usesRememberShim = true;
            rememberFlag.used = false;
          }
          if (typeof bodyLine === "string" && bodyLine.includes("runAtAll(")) {
            usesMapShim = true;
            usesRememberShim = true;
          }
          const linesBody = (bodyLine ?? "/* TODO: platform action */")
            .split("\n")
            .map(line => `  ${line}`);
          refineryLines.push(`static void ${fnName}(void) {`);
          refineryLines.push(...linesBody);
          refineryLines.push("}");
          runFns.push(fnName);
          names.push(platform.name);
          actions.push({ evoke: actionEvoke, result: actionLine });
          const depName = sanitizeName(`${prefix}_${platform.name}_deps`);
          const deps = platform.deps.map(dep => JSON.stringify(dep)).join(", ");
          depArrays.push(`static const char *${depName}[] = { ${deps}${deps ? ", " : ""}NULL };`);
        });
        refineryLines.push(...depArrays);
        refineryLines.push(`static const char *${nameVar}[] = { ${names.map(n => JSON.stringify(n)).join(", ")} };`);
        refineryLines.push(`static void (*${runVar}[])(void) = { ${runFns.join(", ")} };`);
        refineryLines.push(`static const char **${depsVar}[] = { ${refinery.platforms.map(p => sanitizeName(`${prefix}_${p.name}_deps`)).join(", ")} };`);
        refineryLines.push(`static const int ${depCountVar}[] = { ${refinery.platforms.map(p => p.deps.length).join(", ")} };`);
        refineryLines.push(`static const char *${actionVar}[] = { ${actions.map(action => JSON.stringify(action.result)).join(", ")} };`);
        refineryLines.push(`static const char *${actionVar}_evoke[] = { ${actions.map(action => JSON.stringify(action.evoke)).join(", ")} };`);
        refineryLines.push(`static int ${depLookup}(const char *name) {`);
        refineryLines.push(`  for (int i = 0; i < ${count}; i++) { if (strcmp(${nameVar}[i], name) == 0) return i; }`);
        refineryLines.push("  return -1;");
        refineryLines.push("}");
        refineryLines.push(`static int ${runFn}(void) {`);
        refineryLines.push(`  const char *refineryName = ${JSON.stringify(refineryName)};`);
        refineryLines.push(`  const int retry_max_attempts = ${Math.max(1, Math.floor(effectiveRetryConfig.maxAttempts || 1))};`);
        refineryLines.push(`  const int retry_initial_delay_ms = ${Math.max(0, Math.trunc(effectiveRetryConfig.initialDelayMs || 0))};`);
        refineryLines.push(`  const int retry_max_delay_ms = ${Math.max(0, Math.trunc(effectiveRetryConfig.maxDelayMs || 0))};`);
        refineryLines.push(`  const double retry_backoff = ${Math.max(1, Number(effectiveRetryConfig.backoff || 1))};`);
        refineryLines.push("  const int checkpoint_enabled = getenv(\"PYA_NO_CHECKPOINT\") ? 0 : 1;");
        refineryLines.push("  pya_load_checkpoints();");
        refineryLines.push(`  int done[${count}];`);
        refineryLines.push(`  const char *results[${count}];`);
        refineryLines.push(`  for (int i = 0; i < ${count}; i++) { done[i] = 0; results[i] = NULL; }`);
        refineryLines.push("  int completed = 0;");
        refineryLines.push(`  while (completed < ${count}) {`);
        refineryLines.push("    int next = -1;");
        refineryLines.push(`    for (int i = 0; i < ${count}; i++) {`);
        refineryLines.push("      if (done[i]) continue;");
        refineryLines.push("      int ready = 1;");
        refineryLines.push(`      for (int d = 0; d < ${depCountVar}[i]; d++) {`);
        refineryLines.push(`        int idx = ${depLookup}(${depsVar}[i][d]);`);
        refineryLines.push("        if (idx < 0 || !done[idx]) { ready = 0; break; }");
        refineryLines.push("      }");
        refineryLines.push("      if (!ready) continue;");
        refineryLines.push("      if (next < 0 || strcmp(" + nameVar + "[i], " + nameVar + "[next]) < 0) next = i;");
        refineryLines.push("    }");
        refineryLines.push("    if (next < 0) return 1;");
        refineryLines.push(`    const int depCount = ${depCountVar}[next];`);
        refineryLines.push(`    const char **depNames = ${depsVar}[next];`);
        refineryLines.push("    const char *depResults[(depCount > 0 ? depCount : 1)];");
        refineryLines.push("    for (int d = 0; d < depCount; d++) {");
        refineryLines.push(`      int idx = ${depLookup}(depNames[d]);`);
        refineryLines.push("      depResults[d] = (idx >= 0 && results[idx]) ? results[idx] : \"\";");
        refineryLines.push("    }");
        refineryLines.push("    char checkpointHash[16];");
        refineryLines.push(`    pya_checkpoint_hash(${actionVar}[next], depNames, depResults, depCount, checkpointHash);`);
        refineryLines.push("    if (checkpoint_enabled) {");
        refineryLines.push(`      const char *checkpointResult = pya_find_checkpoint(refineryName, ${nameVar}[next], checkpointHash);`);
        refineryLines.push("      if (checkpointResult) {");
        refineryLines.push("        char checkpointLine[PYA_TEXT_CAP];");
        refineryLines.push("        snprintf(checkpointLine, sizeof(checkpointLine), \"su name %s ob text \\\"%s\\\" from name %s to la %s ko be checkpoint ya\", " + nameVar + "[next], checkpointHash, refineryName, checkpointResult);");
        refineryLines.push("        pya_emit_exchange(checkpointLine);");
        refineryLines.push("        pya_emit_exchange(checkpointResult);");
        refineryLines.push("        results[next] = checkpointResult;");
        refineryLines.push("        done[next] = 1;");
        refineryLines.push("        completed += 1;");
        refineryLines.push("        continue;");
        refineryLines.push("      }");
        refineryLines.push("    }");
        refineryLines.push("    int attempt = 0;");
        refineryLines.push("    int delay_ms = retry_initial_delay_ms;");
        refineryLines.push("    while (attempt < retry_max_attempts) {");
        refineryLines.push("      attempt += 1;");
        refineryLines.push("      pya_exchange_reset_error();");
        refineryLines.push(`      pya_emit_exchange(${actionVar}_evoke[next]);`);
        refineryLines.push(`      ${runVar}[next]();`);
        refineryLines.push("      if (pya_exchange_has_error()) {");
        refineryLines.push("        if (attempt < retry_max_attempts) {");
        refineryLines.push("          char retryLine[PYA_TEXT_CAP];");
        refineryLines.push("          char retryMsg[PYA_TEXT_CAP];");
        refineryLines.push("          pya_escape_text(pya_exchange_error_text(), retryMsg, sizeof(retryMsg));");
        refineryLines.push("          snprintf(retryLine, sizeof(retryLine), \"su name %s by num %d ob text \\\"%s\\\" from name %s be reiterate ya\", " + nameVar + "[next], attempt + 1, retryMsg, refineryName);");
        refineryLines.push("          pya_emit_exchange(retryLine);");
        refineryLines.push("          pya_sleep_ms(delay_ms);");
        refineryLines.push("          int next_delay = (int)(delay_ms * retry_backoff);");
        refineryLines.push("          if (next_delay > retry_max_delay_ms) next_delay = retry_max_delay_ms;");
        refineryLines.push("          delay_ms = next_delay;");
        refineryLines.push("          continue;");
        refineryLines.push("        }");
        refineryLines.push("        return 1;");
        refineryLines.push("      }");
        refineryLines.push(`      pya_emit_exchange(${actionVar}[next]);`);
        refineryLines.push(`      results[next] = ${actionVar}[next];`);
        refineryLines.push("      if (checkpoint_enabled) {");
        refineryLines.push("        char checkpointLine[PYA_TEXT_CAP];");
        refineryLines.push("        snprintf(checkpointLine, sizeof(checkpointLine), \"su name %s ob text \\\"%s\\\" from name %s to la %s ko be checkpoint ya\", " + nameVar + "[next], checkpointHash, refineryName, " + actionVar + "[next]);");
        refineryLines.push("        pya_emit_exchange(checkpointLine);");
        refineryLines.push("      }");
        refineryLines.push("      done[next] = 1;");
        refineryLines.push("      completed += 1;");
        refineryLines.push("      break;");
        refineryLines.push("    }");
        refineryLines.push("  }");
        refineryLines.push("  return 0;");
        refineryLines.push("}");
        mainLines.push(`if (getenv("PYA_REFINERY") && strcmp(getenv("PYA_REFINERY"), ${JSON.stringify(refineryName)}) == 0) { if (${runFn}() != 0) return 1; }`);
      }
      lines.push(...refineryLines);
    } else {
      const refineryLines = [];
      refineryLines.push("const __pyaRefineries = {};");
      refineryLines.push("const __pyaCompareUtf8 = (() => {");
      refineryLines.push("  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;");
      refineryLines.push("  return (a, b) => {");
      refineryLines.push("    if (a === b) return 0;");
      refineryLines.push("    const bufA = encoder ? encoder.encode(a) : Array.from(a, ch => ch.charCodeAt(0));");
      refineryLines.push("    const bufB = encoder ? encoder.encode(b) : Array.from(b, ch => ch.charCodeAt(0));");
      refineryLines.push("    const len = Math.min(bufA.length, bufB.length);");
      refineryLines.push("    for (let i = 0; i < len; i += 1) {");
      refineryLines.push("      if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;");
      refineryLines.push("    }");
      refineryLines.push("    return bufA.length < bufB.length ? -1 : 1;");
      refineryLines.push("  };");
      refineryLines.push("})();");
      refineryLines.push("const __pyaNewspaper = (typeof process !== \"undefined\" ? process.env?.PYA_NEWSPAPER : undefined) === \"1\";");
      refineryLines.push("let __pyaLastErrorLine = null;");
      refineryLines.push("const __pyaEmitNewspaper = (line) => {");
      refineryLines.push("  if (!__pyaNewspaper || !line) return;");
      refineryLines.push("  const text = String(line);");
      refineryLines.push("  if (text.includes(\" be error ya\")) __pyaLastErrorLine = text;");
      refineryLines.push("  if (text.includes(\"\\n\")) {");
      refineryLines.push("    console.log(\"PYA_NEWSPAPER:BEGIN\");");
      refineryLines.push("    console.log(text);");
      refineryLines.push("    console.log(\"PYA_NEWSPAPER:END\");");
      refineryLines.push("  } else {");
      refineryLines.push("    console.log(\"PYA_NEWSPAPER:\" + text);");
      refineryLines.push("  }");
      refineryLines.push("};");
      refineryLines.push("if (typeof pyaEmitNewspaper === \"function\") {");
      refineryLines.push("  const __pyaOrig = pyaEmitNewspaper;");
      refineryLines.push("  pyaEmitNewspaper = (line) => {");
      refineryLines.push("    if (line && String(line).includes(\" be error ya\")) __pyaLastErrorLine = String(line);");
      refineryLines.push("    return __pyaOrig(line);");
      refineryLines.push("  };");
      refineryLines.push("}");
      refineryLines.push("const __pyaRetry = " + JSON.stringify(effectiveRetryConfig) + ";");
      refineryLines.push("const __pyaCheckpointEnabled = !(typeof process !== \"undefined\" && process?.env?.PYA_NO_CHECKPOINT === \"1\");");
      refineryLines.push("const __pyaCheckpoints = new Map();");
      refineryLines.push("const __pyaCheckpointUnescape = (value) => String(value || \"\")");
      refineryLines.push("  .replace(/\\\\t/g, \"\\t\")");
      refineryLines.push("  .replace(/\\\\r/g, \"\\r\")");
      refineryLines.push("  .replace(/\\\\n/g, \"\\n\")");
      refineryLines.push("  .replace(/\\\\\\\\/g, \"\\\\\");");
      refineryLines.push("const __pyaCheckpointLoad = () => {");
      refineryLines.push("  if (!__pyaCheckpointEnabled) return;");
      refineryLines.push("  const raw = (typeof process !== \"undefined\" ? process?.env?.PYA_CHECKPOINTS : undefined) || \"\";");
      refineryLines.push("  if (!raw) return;");
      refineryLines.push("  for (const line of raw.split(/\\r?\\n/)) {");
      refineryLines.push("    if (!line) continue;");
      refineryLines.push("    const parts = line.split(\"\\t\");");
      refineryLines.push("    if (parts.length < 4) continue;");
      refineryLines.push("    const refinery = __pyaCheckpointUnescape(parts[0]);");
      refineryLines.push("    const platform = __pyaCheckpointUnescape(parts[1]);");
      refineryLines.push("    const hash = __pyaCheckpointUnescape(parts[2]);");
      refineryLines.push("    const result = __pyaCheckpointUnescape(parts.slice(3).join(\"\\t\"));");
      refineryLines.push("    __pyaCheckpoints.set(`${refinery}::${platform}::${hash}`, result);");
      refineryLines.push("  }");
      refineryLines.push("};");
      refineryLines.push("const __pyaFnv1aHex = (text) => {");
      refineryLines.push("  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;");
      refineryLines.push("  const bytes = encoder ? encoder.encode(String(text ?? \"\")) : Array.from(String(text ?? \"\"), ch => ch.charCodeAt(0));");
      refineryLines.push("  let hash = 0x811c9dc5;");
      refineryLines.push("  for (const byte of bytes) {");
      refineryLines.push("    hash ^= byte;");
      refineryLines.push("    hash = (hash * 0x01000193) >>> 0;");
      refineryLines.push("  }");
      refineryLines.push("  return hash.toString(16).padStart(8, \"0\");");
      refineryLines.push("};");
      refineryLines.push("const __pyaCheckpointHash = (actionLine, depNames, depResults) => {");
      refineryLines.push("  const parts = [`action:${actionLine}`];");
      refineryLines.push("  for (let i = 0; i < depNames.length; i += 1) {");
      refineryLines.push("    parts.push(`dep:${depNames[i]}:${depResults[i] ?? \"\"}`);");
      refineryLines.push("  }");
      refineryLines.push("  return __pyaFnv1aHex(parts.join(\"\\n\"));");
      refineryLines.push("};");
      refineryLines.push("const __pyaSleepMs = (ms) => {");
      refineryLines.push("  const delay = Math.max(0, Number(ms) || 0);");
      refineryLines.push("  if (!delay) return;");
      refineryLines.push("  if (typeof Atomics === \"object\" && typeof SharedArrayBuffer === \"function\") {");
      refineryLines.push("    const buf = new SharedArrayBuffer(4);");
      refineryLines.push("    const view = new Int32Array(buf);");
      refineryLines.push("    Atomics.wait(view, 0, 0, delay);");
      refineryLines.push("    return;");
      refineryLines.push("  }");
      refineryLines.push("  const start = Date.now();");
      refineryLines.push("  while (Date.now() - start < delay) {}");
      refineryLines.push("};");
      refineryLines.push("function __pyaRunRefinery(name) {");
      refineryLines.push("  const refinery = __pyaRefineries[name];");
      refineryLines.push("  if (!refinery) return null;");
      refineryLines.push("  __pyaCheckpointLoad();");
      refineryLines.push("  const completed = new Set();");
      refineryLines.push("  const results = new Map();");
      refineryLines.push("  const pending = new Set(Object.keys(refinery.platforms));");
      refineryLines.push("  while (pending.size > 0) {");
      refineryLines.push("    const ready = [];");
      refineryLines.push("    for (const platformName of pending) {");
      refineryLines.push("      const platform = refinery.platforms[platformName];");
      refineryLines.push("      const deps = platform?.deps || [];");
      refineryLines.push("      if (deps.every((dep) => completed.has(dep))) ready.push(platformName);");
      refineryLines.push("    }");
      refineryLines.push("    if (ready.length === 0) return null;");
      refineryLines.push("    ready.sort(__pyaCompareUtf8);");
      refineryLines.push("    const next = ready[0];");
      refineryLines.push("    const platform = refinery.platforms[next];");
      refineryLines.push("    const deps = platform?.deps || [];");
      refineryLines.push("    const depNames = [...deps].sort(__pyaCompareUtf8);");
      refineryLines.push("    const depResults = depNames.map(dep => results.get(dep) ?? \"\");");
      refineryLines.push("    const checkpointHash = __pyaCheckpointHash(platform.result, depNames, depResults);");
      refineryLines.push("    const checkpointKey = `${name}::${next}::${checkpointHash}`;");
      refineryLines.push("    const checkpointResult = __pyaCheckpointEnabled ? __pyaCheckpoints.get(checkpointKey) : null;");
      refineryLines.push("    if (__pyaCheckpointEnabled && checkpointResult) {");
      refineryLines.push("      __pyaEmitNewspaper(`su name ${next} ob text \"${checkpointHash}\" from name ${name} to la ${checkpointResult} ko be checkpoint ya`);");
      refineryLines.push("      __pyaEmitNewspaper(checkpointResult);");
      refineryLines.push("      results.set(next, checkpointResult);");
      refineryLines.push("      completed.add(next);");
      refineryLines.push("      pending.delete(next);");
      refineryLines.push("      continue;");
      refineryLines.push("    }");
      refineryLines.push("    let attempt = 0;");
      refineryLines.push("    let delayMs = __pyaRetry.initialDelayMs || 0;");
      refineryLines.push("    for (;;) {");
      refineryLines.push("      attempt += 1;");
      refineryLines.push("      __pyaLastErrorLine = null;");
      refineryLines.push("      __pyaEmitNewspaper(platform.evoke);");
      refineryLines.push("      let res;");
      refineryLines.push("      try { res = platform.run(); } catch (err) {");
      refineryLines.push("        const msg = err?.message ? String(err.message) : \"refinery failed\";");
      refineryLines.push("        __pyaEmitNewspaper(`su name refinery failure ob text ${msg.replace(/\\\\/g, \"\\\\\\\\\").replace(/\"/g, \"\\\\\\\"\")} from name runtime be error ya`);");
      refineryLines.push("        res = { be: \"error\", mood: \"ya\" };");
      refineryLines.push("      }");
      refineryLines.push("      const sawError = (res && res.be === \"error\" && res.mood) || __pyaLastErrorLine;");
      refineryLines.push("      if (sawError) {");
      refineryLines.push("        if (attempt < (__pyaRetry.maxAttempts || 1)) {");
      refineryLines.push("          const errText = __pyaLastErrorLine || (res?.ob?.text ?? \"reiterate\");");
      refineryLines.push("          const errQuoted = JSON.stringify(String(errText));");
      refineryLines.push("          __pyaEmitNewspaper(`su name ${next} by num ${attempt + 1} ob text ${errQuoted} from name ${name} be reiterate ya`);");
      refineryLines.push("          __pyaSleepMs(delayMs);");
      refineryLines.push("          delayMs = Math.min(Math.trunc(delayMs * (__pyaRetry.backoff || 1)), __pyaRetry.maxDelayMs || delayMs);");
      refineryLines.push("          continue;");
      refineryLines.push("        }");
      refineryLines.push("        return res || { be: \"error\" };");
      refineryLines.push("      }");
      refineryLines.push("      __pyaEmitNewspaper(platform.result);");
      refineryLines.push("      results.set(next, platform.result);");
      refineryLines.push("      if (__pyaCheckpointEnabled) {");
      refineryLines.push("        __pyaEmitNewspaper(`su name ${next} ob text \"${checkpointHash}\" from name ${name} to la ${platform.result} ko be checkpoint ya`);");
      refineryLines.push("      }");
      refineryLines.push("      completed.add(next);");
      refineryLines.push("      pending.delete(next);");
      refineryLines.push("      break;");
      refineryLines.push("    }");
      refineryLines.push("  }");
      refineryLines.push("  return null;");
      refineryLines.push("}");
      for (const [refineryName, refinery] of refineryDefs.entries()) {
        refineryLines.push(`__pyaRefineries[${JSON.stringify(refineryName)}] = { platforms: {} };`);
        refinery.platforms.forEach((platform) => {
          const fnName = sanitizeName(`pya_refinery_${refineryName}_${platform.name}`);
          const actionLine = sentenceToPyash(platform.action);
          const evokeLine = `ob la ${actionLine} ko be evoke ya`;
          const bodyLine = transpileSentence(platform.action, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
          if (typeof bodyLine === "string" && bodyLine.includes("remember(")) usesRememberShim = true;
          if (rememberFlag.used) {
            usesRememberShim = true;
            rememberFlag.used = false;
          }
          if (typeof bodyLine === "string" && bodyLine.includes("runAtAll(")) {
            usesMapShim = true;
            usesRememberShim = true;
          }
          const bodyLines = (bodyLine ?? "// TODO: platform action")
            .split("\n")
            .map(line => `  ${line}`);
          refineryLines.push(`function ${fnName}() {`);
          refineryLines.push(...bodyLines);
          refineryLines.push("}");
          refineryLines.push(`__pyaRefineries[${JSON.stringify(refineryName)}].platforms[${JSON.stringify(platform.name)}] = { deps: ${JSON.stringify(platform.deps)}, run: ${fnName}, evoke: ${JSON.stringify(evokeLine)}, result: ${JSON.stringify(actionLine)} };`);
        });
      }
      refineryLines.push("const __pyaRefineryName = (typeof process !== \"undefined\" ? process.env?.PYA_REFINERY : undefined) || (typeof globalThis !== \"undefined\" ? globalThis.PYA_REFINERY : undefined);");
      refineryLines.push("if (__pyaRefineryName) __pyaRunRefinery(__pyaRefineryName);");
      lines.push(...refineryLines);
    }
  }

  if (lang !== "c") {
    const prelude = [lines[0]];
    if (jsHelpers.usesYamlRuntime) jsHelpers.usesJsonRuntime = true;
    if (mindShim.used) {
      jsHelpers.usesVectorFormat = true;
      prelude.push(`const mindConfigs = new Map();`);
      prelude.push(`const mindAnswerCounters = new Map();`);
      const mindHelper = mindHelperSource();
      const mindHistory = mindHistorySource();
      const mindToolHelper = mindToolHelperSource();

      prelude.push(mindHelper);
      prelude.push(mindHistory);
      prelude.push(mindToolHelper);
      if (!jsHelpers.usesExchange) {
        prelude.push(newspaperRuntimeHelper());
      }
    }
    if (jsHelpers.usesCommand) {
      const commandHelper = `function pyaCommand(cmd, input) {\n  if (typeof process !== \"undefined\" && process.env?.PYA_COMMAND_RESPONSE !== undefined) {\n    return String(process.env.PYA_COMMAND_RESPONSE ?? \"\");\n  }\n  const res = child_process.spawnSync(String(cmd ?? \"\"), {\n    shell: true,\n    input: input ?? undefined,\n    encoding: \"utf8\",\n    maxBuffer: 1024 * 1024\n  });\n  if (res.error || res.status) {\n    throw new Error(\"command defective\");\n  }\n  return String(res.stdout ?? \"\");\n}`;
      prelude.push(commandHelper);
    }
    if (usesRememberShim) {
      const rememberShim = `const remember = (typeof globalThis.remember === "function" ? globalThis.remember : (ref) => {\n  if (ref && typeof ref === "object") {\n    const name = ref.name || ref.su?.name;\n    if (typeof name === \"string\") {\n      if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, name)) return globalThis[name];\n    }\n    return ref;\n  }\n  if (typeof ref === \"string\") {\n    if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, ref)) return globalThis[ref];\n    return undefined;\n  }\n  return ref;\n});`;
      prelude.push(rememberShim);
    }
    if (usesMapShim) {
      const cloneShim = `const structuredClone = globalThis.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));`;
      prelude.push(cloneShim);
	      const mapHelper = `function runAtAll(sentence, fn) {\n  // Resolve genitive by (like \"by num of fromindex of this\") against the evoker sentence once.\n  if (sentence?.by?.genitive?.chain?.[0] === \"this\") {\n    let curr = sentence;\n    for (const part of sentence.by.genitive.chain.slice(1)) {\n      if (typeof curr === \"number\") {\n        if (part === \"num\") continue;\n        curr = undefined;\n        break;\n      }\n      curr = curr?.[part];\n    }\n    const resolved = (typeof curr === \"number\") ? curr : curr?.num;\n    if (typeof resolved === \"number\") sentence.by = { num: resolved };\n  }\n  const vecFact = remember(sentence.ob?.name ?? sentence.ob);\n  const values = vecFact?.ob?.ve?.values ?? [];\n  const out = values.map((elem, i) => {\n    const elemSentence = structuredClone(sentence);\n    if (typeof elem === \"number\") elemSentence.ob = { num: elem };\n    else if (typeof elem === \"string\") elemSentence.ob = { text: elem };\n    else if (typeof elem === \"boolean\") elemSentence.ob = { boolean: elem };\n    else elemSentence.ob = elem ?? {};\n    elemSentence.atindex = { num: i, register: true };\n    elemSentence.this = { ...(elemSentence.this || {}), atindex: elemSentence.atindex, by: elemSentence.by, fromindex: elemSentence.fromindex, toindex: elemSentence.toindex };\n    const res = fn(elemSentence) ?? elemSentence;\n    const ob = res?.ob ?? elemSentence.ob;\n    if (ob?.num !== undefined) return ob.num;\n    if (ob?.text !== undefined) return ob.text;\n    if (ob?.boolean !== undefined) return ob.boolean;\n    return ob;\n  });\n  if (sentence.to?.name) {\n    const fact = { su: { name: sentence.to.name }, ob: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n    globalThis[sentence.to.name] = fact;\n    return fact;\n  }\n  // In-place: mutate the remembered fact and do not replace the binding object.\n  if (vecFact?.ob?.ve) {\n    vecFact.ob.ve.values = out;\n    return vecFact;\n  }\n  const targetName = sentence.ob?.name ?? vecFact?.su?.name;\n  if (targetName) {\n    const fact = { su: { name: targetName }, ob: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n    globalThis[targetName] = fact;\n    return fact;\n  }\n  return { ob: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n}`;
      prelude.push(mapHelper);
    }
    if (jsHelpers.usesExchange) {
      prelude.push(exchangeRuntimeHelper());
    }
    if (jsHelpers.usesVectorFormat) {
      prelude.push(vectorFormatHelper());
    }
    if (jsHelpers.usesJsonRuntime) {
      prelude.push(jsonRuntimeHelper());
    }
    if (jsHelpers.usesYamlRuntime) {
      prelude.push(yamlRuntimeHelper());
    }
    if (jsHelpers.usesYamlStringify) {
      prelude.push(yamlStringifyHelper());
    }
    if (jsHelpers.usesCsvRuntime) {
      prelude.push(csvRuntimeHelper());
    }
    if (jsHelpers.usesJsonMap) {
      prelude.push(`function jsonFromMap(name, seen = new Set()) {\n  const map = globalThis[name];\n  if (!map || map.be !== \"json map\") throw new Error(\"json map referential defective\");\n  const mapName = map.su?.name ?? name;\n  if (seen.has(mapName)) throw new Error(\"json map export self referential\");\n  seen.add(mapName);\n  const out = {};\n  const entries = map.ob?.map ?? {};\n  for (const key of Object.keys(entries)) {\n    const value = entries[key];\n    let jsonValue;\n    if (value?.unspecified) jsonValue = undefined;\n    else if (value?.hollow) jsonValue = null;\n    else if (value?.text !== undefined) jsonValue = value.text;\n    else if (value?.num !== undefined) jsonValue = value.num;\n    else if (value?.boolean !== undefined) jsonValue = value.boolean;\n    else if (value?.ve) {\n      const type = value.ve.type || \"num\";\n      if (type === \"hollow\") jsonValue = [];\n      else if (type === \"name\") jsonValue = (value.ve.values || []).map((child) => jsonFromMap(child, seen));\n      else if (type === \"bool\" || type === \"boolean\") jsonValue = (value.ve.values || []).map((v) => v === \"truth\" || v === true || v === 1);\n      else if (type === \"num\" || type === \"number\" || type === \"text\") jsonValue = value.ve.values || [];\n      else throw new Error(\"json map contents defective: unsupported vector type \" + type);\n    } else if (value?.name) {\n      jsonValue = jsonFromMap(value.name, seen);\n    } else if (value && Object.keys(value).length > 0) {\n      throw new Error(\"json map contents defective: unsupported contents\");\n    }\n    if (jsonValue !== undefined) out[key] = jsonValue;\n  }\n  seen.delete(mapName);\n  return out;\n}\nfunction canonicalizeJson(value) {\n  const encoder = typeof TextEncoder !== \"undefined\" ? new TextEncoder() : null;\n  const compareUtf8 = (a, b) => {\n    if (a === b) return 0;\n    const bufA = encoder ? encoder.encode(a) : Array.from(a, ch => ch.charCodeAt(0));\n    const bufB = encoder ? encoder.encode(b) : Array.from(b, ch => ch.charCodeAt(0));\n    const len = Math.min(bufA.length, bufB.length);\n    for (let i = 0; i < len; i += 1) {\n      if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;\n    }\n    return bufA.length < bufB.length ? -1 : 1;\n  };\n  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));\n  if (value && typeof value === \"object\") {\n    const out = {};\n    const keys = Object.keys(value).sort(compareUtf8);\n    for (const key of keys) out[key] = canonicalizeJson(value[key]);\n    return out;\n  }\n  return value;\n}\nfunction formatJsonMap(name, mode = \"canonical\") {\n  const json = jsonFromMap(name);\n  if (mode === \"pretty\") return JSON.stringify(json, null, 2);\n  return JSON.stringify(canonicalizeJson(json));\n}`);
    }
    if (jsHelpers.usesCsvMap) {
      prelude.push(`function csvEscape(value) {\n  const str = String(value ?? \"\");\n  if (/[\",\\n\\r]/.test(str)) {\n    return \"\\\"\" + str.replace(/\"/g, \"\\\"\\\"\") + \"\\\"\";\n  }\n  return str;\n}\nfunction formatCsvMap(name) {\n  const fact = globalThis[name];\n  if (fact?.be === \"text\") return String(fact.ob?.text ?? \"\");\n  if (!fact || fact.be !== \"csv map\") throw new Error(\"csv columns defective\");\n  const entries = fact.ob?.map ?? {};\n  const headerRaw = entries[\"header raw\"]?.ve?.values;\n  const header = entries.header?.ve?.values;\n  let headers = Array.isArray(headerRaw) ? headerRaw : header;\n  if (Array.isArray(headerRaw)) {\n    const seen = new Set();\n    let defective = false;\n    for (const cell of headerRaw) {\n      const key = String(cell ?? \"\").replace(/\\s+/g, \" \").trim().toLowerCase();\n      if (!key || seen.has(key)) { defective = true; break; }\n      seen.add(key);\n    }\n    if (defective) headers = header;\n  }\n  if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(header)) {\n    throw new Error(\"csv columns defective\");\n  }\n  const columns = header.map((key) => {\n    const col = entries[key];\n    if (!col?.ve?.values || col.ve.type !== \"text\") {\n      throw new Error(\"csv columns defective\");\n    }\n    return col.ve.values.map((v) => String(v ?? \"\"));\n  });\n  const length = columns[0]?.length ?? 0;\n  for (const col of columns) {\n    if (col.length !== length) {\n      throw new Error(\"csv columns defective\");\n    }\n  }\n  const lines = [];\n  lines.push(headers.map(csvEscape).join(\",\"));\n  for (let i = 0; i < length; i += 1) {\n    const row = columns.map((col) => csvEscape(col[i] ?? \"\"));\n    lines.push(row.join(\",\"));\n  }\n  return lines.join(\"\\n\") + \"\\n\";\n}`);
    }
    if (jsHelpers.usesFs) {
      prelude.splice(1, 0, `import fs from "node:fs";`);
    }
    if (jsHelpers.usesCommand) {
      prelude.splice(1, 0, `import child_process from "node:child_process";`);
    }
    if (jsHelpers.usesExchange) {
      prelude.splice(1, 0, `import path from "node:path";`);
      prelude.splice(1, 0, `import crypto from "node:crypto";`);
    }
    if (jsHelpers.usesCsvRuntime) {
      prelude.splice(1, 0, `import { parse as parseCsv } from ${JSON.stringify(CSV_PARSE_RUNTIME_URL)};`);
    }
    if (jsHelpers.usesYamlRuntime) {
      prelude.splice(1, 0, `import YAML from ${JSON.stringify(YAML_RUNTIME_URL)};`);
    }
    if (loopShim.used) {
      const loopHelper = `function runLoop(sentence, fn) {\n  for (;;) {\n    const currIdx = sentence?.fromindex?.num ?? sentence?.fromindex ?? 0;\n    const hasUntil = sentence?.toindex !== undefined;\n    const currUntil = sentence?.toindex?.num ?? sentence?.toindex;\n    sentence.fromindex = currIdx;\n    if (hasUntil) sentence.toindex = currUntil;\n    if (hasUntil ? currIdx === currUntil : currIdx === 0) break;\n    const prevIdx = sentence?.fromindex;\n    const prevUntil = sentence?.toindex;\n    const nextSentence = fn(sentence);\n    sentence = { ...sentence, ...(nextSentence || {}) };\n    if (sentence.fromindex === undefined) sentence.fromindex = prevIdx;\n    if (sentence.toindex === undefined) sentence.toindex = prevUntil;\n    let nextIdx;\n    if (hasUntil) {\n      nextIdx = currIdx + (currUntil > currIdx ? 1 : -1);\n    } else {\n      nextIdx = currIdx - 1;\n    }\n    sentence.fromindex = nextIdx;\n  }\n  return sentence;\n}`;
      prelude.push(loopHelper);
    }
    lines = prelude.concat(lines.slice(1));
    if (mindShim.used) {
      const importLines = [];
      const bodyLines = [];
      for (const line of lines) {
        if (line.startsWith("import ")) {
          importLines.push(line);
        } else {
          bodyLines.push(line);
        }
      }
      lines = importLines.concat(["(async () => {", ...bodyLines, "})();"]);
    }
  }

  if (lang === "c") {
    if (cHelpers.usesExchange) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
    }
    const needsCsvRuntime = cHelpers.usesCsvRuntime
      && [...lines, ...mainLines].some((line) => typeof line === "string" && /\bpya_csv_/.test(line));
    const needsYamlRuntime = cHelpers.usesYamlRuntime;
    const needsYamlStringify = cHelpers.usesYamlStringify && !needsYamlRuntime;
    const headers = [];
    if (cHelpers.usesCommand || cHelpers.usesExchange) {
      headers.push("#define _POSIX_C_SOURCE 200809L");
    }
    if (cHelpers.usesPrintf) headers.push("#include <stdio.h>");
    if (cHelpers.usesString) headers.push("#include <string.h>");
    if (cHelpers.usesStdlib) headers.push("#include <stdlib.h>");
    if (cHelpers.usesCtype) headers.push("#include <ctype.h>");
    if (cHelpers.usesExchange) headers.push("#include <stdint.h>");
    if (cHelpers.usesExchange) headers.push("#include <unistd.h>");
    if (cHelpers.usesExchange) headers.push("#include <sys/stat.h>");
    if (cHelpers.usesExchange) headers.push("#include <errno.h>");
    if (cHelpers.usesExchange) headers.push("#include <time.h>");
    if (needsYamlRuntime) headers.push("#include <strings.h>");
    if (needsYamlRuntime) headers.push("#include <yaml.h>");
    if (needsCsvRuntime) {
      headers.push("#include <zsv.h>");
    }
    if (cHelpers.usesMindRuntime) {
      headers.push("#include <curl/curl.h>");
    }
    if (cHelpers.usesCommand) {
      headers.push("#include <unistd.h>");
      headers.push("#include <sys/types.h>");
      headers.push("#include <sys/wait.h>");
    }
    if (lines.some(l => typeof l === "string" && l.includes("fmod(")) || cHelpers.usesJsonRuntime) headers.push("#include <math.h>");
    const needsLoopGlobals =
      [...lines, ...mainLines].some(l => typeof l === "string" && /\b(fromindex|toindex|atindex|by)\b/.test(l));
    if (needsLoopGlobals) {
      headers.push("double fromindex = 0;");
      headers.push("double toindex = 0;");
      headers.push("double atindex = 0;");
      headers.push("double by = 0;");
    }
    if (cHelpers.usesMapGlobals) {
      headers.push("double pya_ob_num = 0;");
      headers.push("double pya_from_num = 0;");
      headers.push("const char *pya_ob_text = 0;");
      headers.push("int pya_ob_bool = 0;");
    }
    if (headers.length) lines.unshift(...headers);
    const cPrelude = [];
    if (cHelpers.usesTextHelper) cPrelude.push(TEXT_HELPER);
    if (cHelpers.usesExchange) cPrelude.push(EXCHANGE_HELPER);
    if (cHelpers.usesJsonRuntime) {
      cPrelude.push(CJSON_HEADER);
      cPrelude.push(CJSON_SOURCE);
      cPrelude.push(JSON_PYASH_HELPER);
    }
    if (cHelpers.usesVectorType) cPrelude.push(VECTOR_TYPE_DECL);
    if (cHelpers.usesVectorPrinter) cPrelude.push(VECTOR_PRINT_HELPER);
    if (cHelpers.usesMap) cPrelude.push(MAP_TYPE_DECL);
    if (cHelpers.usesMap || cHelpers.usesMapPrinter) cPrelude.push(MAP_HELPER);
    if (cHelpers.usesMindRuntime) cPrelude.push(MIND_RUNTIME_HELPER);
    if (cHelpers.usesCommand) cPrelude.push(COMMAND_HELPER);
    if (needsYamlRuntime) cPrelude.push(YAML_RUNTIME_HELPER);
    if (needsYamlStringify) cPrelude.push(YAML_STRINGIFY_HELPER);
    if (needsCsvRuntime) cPrelude.push(CSV_RUNTIME_HELPER);
    if (cPrelude.length) lines.splice(headers.length, 0, ...cPrelude);
    if (cState?.preMain?.length) lines.push(...cState.preMain);
    const body = mainLines.map(l => `  ${l}`).join("\n");
    lines.push("int main(void) {");
    lines.push(body || "  return 0;");
    lines.push("  return 0;");
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}

function inlineSentenceLiteral(value, declared = new Set(), { inlineNames = true } = {}) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => inlineSentenceLiteral(v, declared)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entriesArr = Object.entries(value);
    if (entriesArr.length === 1 && entriesArr[0][0] === "name") {
      const nameVal = entriesArr[0][1];
      if (typeof nameVal === "string" && declared.has(nameVal)) {
        if (inlineNames) {
          return sanitizeName(nameVal);
        }
        return `{ name: ${nameVal} }`;
      }
    }
    const entries = Object.entries(value).map(([key, val]) => {
      if (key === "name" && typeof val === "string" && declared.has(val) && inlineNames) {
        return `${key}: ${val}`;
      }
      return `${key}: ${inlineSentenceLiteral(val, declared, { inlineNames })}`;
    });
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function findDefinitionBlock(sentences, name) {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s?.mood === "def" && s?.be === "ceremony" && s?.su?.name === name) {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      return { def: s, body, prah: sentences[j], end: j };
    }
  }
  return null;
}

function collectExportFacts(record, sentences) {
  const exported = new Map();
  for (const name of record.exportNames) {
    if (record.localCeremonies.has(name)) continue;
    const mapped = record.nameMap.get(name);
    if (!mapped) continue;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (s?.mood === "def" && (s.be === "map" || s.be === "json map") && s?.su?.name === mapped) {
        const entries = [];
        let j = i + 1;
        for (; j < sentences.length; j++) {
          if (sentences[j].mood === "prah") break;
          entries.push(sentences[j]);
        }
        const map = {};
        const internalPrefix = `${record.alias} internal `;
        for (const entry of entries) {
          let key = entry?.su?.name;
          if (!key) continue;
          if (key.startsWith(internalPrefix)) {
            key = key.slice(internalPrefix.length);
          }
          map[key] = entry.ob ?? {};
        }
        exported.set(name, { be: s.be, ob: { map } });
        i = j;
        break;
      }
      if (s?.mood === "ya" && s?.su?.name === mapped) {
        exported.set(name, { be: s.be, ob: s.ob ?? {} });
        break;
      }
    }
  }
  return exported;
}

function mapNamespaceSentences({ alias, exportFacts, nameMap }) {
  const def = { mood: "def", be: "map", su: { name: alias } };
  const entries = [];
  for (const [key, value] of exportFacts.entries()) {
    const mapped = nameMap?.get(key);
    entries.push({ mood: "ya", su: { name: key }, ob: mapped ? { name: mapped } : (value?.ob ?? value ?? {}) });
  }
  const prah = { mood: "prah", be: "map", su: { name: alias } };
  return [def, ...entries, prah];
}

async function expandModulesForCompile(entryPath, sentences) {
  clearModuleCache();
  if (entryPath) setEntryModulePath(entryPath);

  const modules = [];
  const seen = new Set();
  const aliasToId = new Map();
  const entryDir = entryPath ? path.dirname(path.resolve(entryPath)) : process.cwd();
  const normalizeSpecifier = (specifier, baseDir) => {
    if (!specifier) return specifier;
    if (specifier.startsWith("./") || specifier.startsWith("../") || path.isAbsolute(specifier)) {
      return specifier;
    }
    if (specifier.includes("/") || specifier.includes("\\") || specifier.endsWith(".pya")) {
      const primary = path.resolve(baseDir || entryDir, specifier);
      if (fsSync.existsSync(primary)) return primary;
      const fallback = path.resolve(process.cwd(), specifier);
      if (fsSync.existsSync(fallback)) return fallback;
      return primary;
    }
    return specifier;
  };

  const includeModule = async (specifier, alias, baseDir) => {
    const record = await loadModule({
      specifier: normalizeSpecifier(specifier, baseDir),
      alias,
      source: "compile import"
    });
    const cacheKey = `${record.id}::${record.alias}`;
    if (seen.has(cacheKey)) return record;
    seen.add(cacheKey);

    const local = [];
    for (const s of record.sentences) {
      if (s?.mood === "do" && s?.be === "import") {
        const specifier = s?.from?.name ?? s?.from?.filename ?? s?.ob?.filename;
        if (specifier) {
          await includeModule(specifier, s?.to?.name, record.dir);
          continue;
        }
      }
      local.push(s);
    }

    const exportFacts = collectExportFacts(record, local);
    modules.push({ record, sentences: local, exportFacts });
    return record;
  };

  const entry = [];
  const aliasBlocks = [];

  for (const s of sentences) {
    if (s?.mood === "do" && s?.be === "import") {
      const specifier = s?.from?.name ?? s?.from?.filename ?? s?.ob?.filename;
      if (!specifier) {
        entry.push(s);
        continue;
      }
      const symbol = s.ob?.name;
      const record = await includeModule(specifier, symbol ? null : s.to?.name, entryDir);
      const aliasName = symbol ? null : (record.alias ?? s.to?.name);
      if (aliasName) {
        const existing = aliasToId.get(aliasName);
        if (existing && existing !== record.id) {
          throwErrorSentence({
            name: "module alias conflict",
            message: `module alias already used: ${aliasName}`,
            from: { name: "compile" },
            raw: { alias: aliasName, existing, current: record.id }
          });
        }
        aliasToId.set(aliasName, record.id);
      }
      if (symbol) {
        if (record.localCeremonies.has(symbol)) {
          const mapped = record.nameMap.get(symbol);
          const block = findDefinitionBlock(record.sentences, mapped);
          if (block?.def) {
            const localName = s.to?.name ?? symbol;
            aliasBlocks.push({ def: { ...block.def, su: { name: localName } }, body: block.body, prah: block.prah });
          }
        } else {
          const exported = collectExportFacts(record, record.sentences);
          if (exported.has(symbol)) {
            const localName = s.to?.name ?? symbol;
            const fact = exported.get(symbol);
            if (fact?.be === "map" || fact?.be === "json map") {
              const entries = fact.ob?.map ?? {};
              const def = { mood: "def", be: fact.be, su: { name: localName } };
              const body = Object.entries(entries).map(([key, ob]) => ({
                mood: "ya",
                su: { name: key },
                ob: ob ?? {}
              }));
              const prah = { mood: "prah", be: fact.be, su: { name: localName } };
              aliasBlocks.push({ def, body, prah });
            } else {
              aliasBlocks.push({ fact: { mood: "ya", su: { name: localName }, be: fact?.be, ob: fact?.ob ?? {} } });
            }
          }
        }
      }
      continue;
      continue;
    }
    entry.push(s);
  }

  const combined = [];
  for (const mod of modules) {
    combined.push(...mod.sentences);
    if (mod.exportFacts.size && mod.record.alias) {
      combined.push(...mapNamespaceSentences({ alias: mod.record.alias, exportFacts: mod.exportFacts, nameMap: mod.record.nameMap }));
    }
  }

  for (const block of aliasBlocks) {
    if (block.fact) {
      combined.push(block.fact);
      continue;
    }
    combined.push(block.def, ...block.body, block.prah);
  }

  combined.push(...entry);
  return combined;
}

async function compile_from_filename_to_filename(sentence) {
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

export default compile_from_filename_to_filename;
export { transpileSentence, transpileProgram };

export const signatures = [
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename", "fromstate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "javascript", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "ob", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "fromstate", "name", "tostate", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "fromstate", "name", "become", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "ob", "name", "num", "fromstate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "fromstate", "name", "num", "tostate", "name", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "num", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  }
];
