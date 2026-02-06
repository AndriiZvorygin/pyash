import { parseYamlToJsonValue } from "../yaml.mjs";
import { sentenceToPyash } from "../../../beautiful.mjs";
import { throwErrorSentence } from "../../../error.mjs";
import { jsonToPyashText, mapSentenceToPyash } from "../json_map.mjs";
import { handleCommandSentence } from "./emit_command.mjs";
import { handleDoSentence } from "./emit_loop.mjs";
import { handleMindSentence } from "./emit_mind.mjs";
import { handleMapEnumeration } from "./emit_map.mjs";
import { handleMathSentence } from "./emit_math.mjs";
import { handleNativeSentence } from "./emit_native.mjs";
import { handleReadSentence } from "./emit_read.mjs";
import { handleSayOrWrite } from "./emit_write.mjs";
import { handleVectorElementOps } from "./emit_vector.mjs";
import { BASE_BE_HANDLERS } from "./handlers.mjs";
import { indexExprFromAt } from "./index_helpers.mjs";
import { csvTextFromMapSentence, jsonFromMapSentence, mapDefChainFromName } from "./map_helpers.mjs";
import { canonicalizeJsonValue, parseCsvText } from "./parse_helpers.mjs";
import { buildToolSchemasForCompile } from "./tooling.mjs";
import { compareUtf8, markDeclared, sanitizeName, sentenceIdForText } from "./util.mjs";
import { resolveVerbAlias } from "../../../library/verbAliases.mjs";
import { handleRetSentence } from "./ret_helpers.mjs";
import { pathFromGenitive, valueForRole, targetPath, exprForSlot, lvalueForName, vectorValuesExpr, vectorExprFromGenitive, cExpr } from "./expr_helpers.mjs";
import { inlineSentenceLiteral } from "./module_helpers.mjs";
import { handleVectorElementRead } from "./transpile_sentence/vector_element_read.mjs";
import { handleVectorMapAll } from "./transpile_sentence/vector_map_all.mjs";
import { handleVectorLiteral } from "./transpile_sentence/vector_literal.mjs";
import { handleDateLiteral, handleNumberLiteral, handleTextLiteral, handleSentenceLiteral } from "./transpile_sentence/scalar_literals.mjs";

const LANGUAGE_TYPES = new Set([
  "english"
]);

export function transpileSentence(sentence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, ceremonyReturnTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs } = {}) {
  const ob = sentence.ob ?? {};
  const verb = sentence.be || sentence.mood || "";
  const beWords = verb.split(" ").filter(Boolean);
  const isPermanent = beWords[0] === "permanent";
  const baseBeRaw = isPermanent ? beWords.slice(1).join(" ") : verb;
  const aliasBe = resolveVerbAlias(baseBeRaw);
  const baseBe = aliasBe !== baseBeRaw && !ceremonyFns?.has(baseBeRaw) ? aliasBe : baseBeRaw;
  const effectiveBe = baseBe || sentence.mood;
  const literalBe = LANGUAGE_TYPES.has(effectiveBe) ? "text" : effectiveBe;

  const handledRet = handleRetSentence(sentence, { lang, sentenceArg, locals, declared, localsTypes, declaredTypes, cHelpers });
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
    localsTypes,
    declared,
    declaredTypes,
    jsHelpers,
    cHelpers,
    cState
  }, {
    sentenceToPyash,
    sanitizeName,
    markDeclared,
    exprForSlot,
    cExpr
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

  const vectorReadResult = handleVectorElementRead({
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
    cHelpers,
    jsHelpers
  }, {
    sanitizeName,
    pathFromGenitive
  });
  if (vectorReadResult) return vectorReadResult;

  const vectorMapAllResult = handleVectorMapAll({
    sentence,
    baseBe,
    lang,
    sentenceArg,
    ceremonyFns,
    ceremonyReturnTypes,
    declared,
    declaredVectorTypes,
    locals,
    cHelpers,
    cState,
    rememberFlag
  }, {
    sanitizeName,
    pathFromGenitive,
    markDeclared,
    inlineSentenceLiteral,
    transpileSentence
  });
  if (vectorMapAllResult) return vectorMapAllResult;

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

  const nativeResult = handleNativeSentence({
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    declared,
    declaredTypes,
    cHelpers,
    jsHelpers,
    cState,
    rememberFlag
  }, {
    sanitizeName,
    markDeclared,
    inlineSentenceLiteral
  });
  if (nativeResult) return nativeResult;

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
  if (baseBe === "remember" && lang === "c" && !sentenceArg) {
    const genitiveChain = sentence.ob?.genitive?.chain || [];
    const genitiveHint = genitiveChain.filter(part => part !== "this").at(-1);
    const rawName = sentence.to?.name?.split(" ")[0] || genitiveHint || "remembered";
    const targetVar = sanitizeName(rawName) || "remembered";
    const source = sentence.ob?.genitive
      ? pathFromGenitive(sentence.ob.genitive, undefined, { locals, declared, allowCGlobals: true })
      : null;
    if (source && ["pya_to_num", "pya_to_text", "pya_to_bool", "pya_ob_num", "pya_ob_text", "pya_ob_bool", "pya_from_num", "by"].includes(source)) {
      return null;
    }
    const isText = Array.isArray(genitiveChain) && genitiveChain.includes("text");
    const lines = [];
    if (source === "pya_to_text" || isText) {
      lines.push(`char *${targetVar} = ${source ?? "pya_to_text"};`);
    } else {
      lines.push(`double ${targetVar} = ${source ?? "pya_to_num"};`);
    }
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
    cExpr,
    markDeclared
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
    ceremonyReturnTypes,
    loopShim,
    cHelpers,
    cState,
    declared,
    declaredTypes,
    locals,
    localsTypes
  }, {
    inlineSentenceLiteral,
    sanitizeName,
    pathFromGenitive,
    markDeclared
  });
  if (doResult) return doResult;
  if (!name || mood === "do") return null;

  const shouldDeclare = Boolean(sentence.exists);
  if (shouldDeclare && literalBe === "text" && typeof ob.text !== "string" && !sentenceArg) {
    const varName = sanitizeName(name);
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesPrintf = true;
      }
      locals?.add(varName);
      if (localsTypes) localsTypes.set(varName, "text");
      return `char ${varName}[PYA_TEXT_CAP] = \"\";`;
    }
    return `let ${varName} = { su: { name: ${JSON.stringify(name)} }, ob: { text: \"\" }, be: \"text\", mood: \"ya\" };\nglobalThis[${JSON.stringify(name)}] = ${varName};`;
  }

  const vectorLiteralResult = handleVectorLiteral({
    sentence,
    effectiveBe: literalBe,
    ob,
    lang,
    sentenceArg,
    name,
    shouldDeclare,
    locals,
    localsTypes,
    declared,
    declaredVectorTypes,
    cHelpers,
    cState
  }, {
    valueForRole,
    pathFromGenitive,
    sanitizeName,
    markDeclared
  });
  if (vectorLiteralResult) return vectorLiteralResult;

  const dateLiteralResult = handleDateLiteral({
    sentence,
    ob,
    lang,
    sentenceArg,
    name,
    effectiveBe: literalBe,
    shouldDeclare,
    locals,
    localsTypes,
    declared,
    cHelpers
  }, {
    sanitizeName,
    valueForRole
  });
  if (dateLiteralResult) return dateLiteralResult;

  const numberLiteralResult = handleNumberLiteral({
    sentence,
    ob,
    lang,
    sentenceArg,
    name,
    effectiveBe: literalBe,
    shouldDeclare,
    locals,
    localsTypes,
    declared,
    declaredTypes,
    isPermanent
  }, {
    sanitizeName,
    valueForRole,
    exprForSlot
  });
  if (numberLiteralResult) return numberLiteralResult;

  const textLiteralResult = handleTextLiteral({
    sentence,
    ob,
    lang,
    sentenceArg,
    name,
    effectiveBe: literalBe,
    shouldDeclare,
    locals,
    localsTypes,
    declared,
    cHelpers
  }, {
    sanitizeName,
    valueForRole
  });
  if (textLiteralResult) return textLiteralResult;

  const sentenceLiteralResult = handleSentenceLiteral({
    sentence,
    ob,
    lang,
    name,
    effectiveBe,
    shouldDeclare,
    locals,
    localsTypes,
    cHelpers,
    declared
  }, {
    sanitizeName,
    inlineSentenceLiteral,
    sentenceToPyash
  });
  if (sentenceLiteralResult) return sentenceLiteralResult;

  return null;
}
