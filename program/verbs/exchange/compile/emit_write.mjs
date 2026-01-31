import { handleMindWrite } from "./emit_write_mind.mjs";
import { readWriteFormat } from "./emit_write/format_flags.mjs";
import { handleCCollectionPrint } from "./emit_write/c_collection_print.mjs";
import { handleJsonFromPyash } from "./emit_write/pyash_json.mjs";
import { handleYamlFromPyash } from "./emit_write/pyash_yaml.mjs";
import { handleCWriteOutput } from "./emit_write/c_write_output.mjs";

export function handleSayOrWrite({
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
} = {}) {
  if (!(baseBe === "say" || (baseBe === "write" && !hasWriteIndex))) return null;

  const ob = sentence.ob ?? {};
  cState.evokeCounter = (cState.evokeCounter ?? -1) + 1;
  const sentenceId = sentenceIdForText(sentenceToPyash(sentence), cState.evokeCounter);
  const isWrite = baseBe === "write";
  const { jsonMode, wantJson, wantYaml, wantCsv } = readWriteFormat(sentence);
  // Special case: write to <mind> -> invoke mind (JS/C)
  const mindWrite = handleMindWrite({
    sentence,
    baseBe,
    lang,
    ob,
    declaredTypes,
    mindShim,
    rememberFlag,
    jsHelpers,
    mapDefs
  }, {
    sanitizeName,
    sentenceToPyash
  });
  if (mindWrite) return mindWrite;
  if (baseBe === "write" && lang === "c") {
    const mindTarget = sentence.for?.name ?? sentence.to?.name;
    const hasMindTarget =
      sentence.for?.name ||
      sentence.totext?.name ||
      (sentence.to?.name && declaredTypes?.get(sentence.to.name) === "mind");
    if (hasMindTarget) {
      const derived = { ...sentence, be: "mind", to: mindTarget ? { name: mindTarget } : sentence.to };
      return transpileSentence(derived, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
    }
  }

  const genChain = sentence.ob?.genitive?.chain || [];
  const wantsVector = genChain.at(-1) === "ve" || declaredTypes?.get(sentence.ob?.name) === "vector";

  const cCollection = handleCCollectionPrint({
    sentence,
    ob,
    lang,
    declaredTypes,
    locals,
    declared,
    cHelpers,
    wantsVector,
    sentenceArg
  }, {
    sanitizeName,
    vectorExprFromGenitive
  });
  if (cCollection) return cCollection;

  let expr = "undefined";
  let forcedExpr = false;
  const jsonResult = handleJsonFromPyash({
    sentence,
    ob,
    lang,
    wantJson,
    jsonMode,
    declaredTypes,
    jsHelpers,
    cHelpers,
    rememberFlag,
    cState,
    isWrite
  }, {
    sanitizeName
  });
  if (jsonResult.code) return jsonResult.code;
  if (jsonResult.forced) {
    expr = jsonResult.expr;
    forcedExpr = true;
  }
  if (!forcedExpr) {
    const yamlResult = handleYamlFromPyash({
      sentence,
      ob,
      lang,
      wantYaml,
      declaredTypes,
      jsHelpers,
      cHelpers,
      rememberFlag,
      cState,
      isWrite
    }, {
      sanitizeName
    });
    if (yamlResult.code) return yamlResult.code;
    if (yamlResult.forced) {
      expr = yamlResult.expr;
      forcedExpr = true;
    } else if (typeof ob.text === "string") {
      expr = JSON.stringify(ob.text);
    } else if (ob.genitive) {
      if (wantsVector) {
        if (jsHelpers) jsHelpers.usesVectorFormat = true;
        const vecExpr = vectorExprFromGenitive(ob.genitive, sentenceArg, { locals, declared });
        if (vecExpr) expr = `formatVector((${vecExpr})?.values ?? [], (${vecExpr})?.type ?? "num")`;
      } else {
        expr = pathFromGenitive(ob.genitive, sentenceArg, { allowCGlobals: true }) ?? expr;
      }
    } else if (ob.name) {
      const name = sanitizeName(ob.name);
      const isMap = declaredTypes?.get(ob.name) === "map";
      const isJsonMap = declaredTypes?.get(ob.name) === "json map";
      const isCsvMap = declaredTypes?.get(ob.name) === "csv map";
      const isSentence = declaredTypes?.get(ob.name) === "sentence" || declaredTypes?.get(ob.name) === "list";
      if (isMap) {
        const chain = mapDefs?.has(ob.name)
          ? mapDefChainFromName(ob.name, mapDefs, { formatter: mapSentenceToPyash })
          : "";
        if (lang === "c") {
          expr = JSON.stringify(chain);
        } else {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          const mapExpr = (locals?.has(name) || declared?.has(name)) ? name : `remember(${JSON.stringify(ob.name)})`;
          expr = `formatMapSentence(${JSON.stringify(ob.name)}, ${mapExpr})`;
        }
      }
      if (isJsonMap) {
        if (wantJson) {
          if (lang === "c") {
            const suffix = jsonMode === "pretty" ? "json_pretty" : "json";
            expr = sanitizeName(`${ob.name}_${suffix}`);
          } else {
            if (jsHelpers) jsHelpers.usesJsonMap = true;
            expr = `formatJsonMap(${JSON.stringify(ob.name)}, ${JSON.stringify(jsonMode)})`;
          }
        } else if (wantYaml) {
          if (lang === "c") {
            const mapSentence = mapDefs?.get(ob.name);
            if (mapSentence && mapSentence.be === "json map") {
              const yamlText = cState?.yamlMapStrings?.get(ob.name);
              if (yamlText) {
                expr = JSON.stringify(yamlText);
              }
            }
            if (expr === "undefined") {
              if (cHelpers) {
                cHelpers.usesYamlStringify = true;
                cHelpers.usesJsonRuntime = true;
                cHelpers.usesTextHelper = true;
                cHelpers.usesString = true;
                cHelpers.usesStdlib = true;
                cHelpers.usesPrintf = true;
                cHelpers.usesCtype = true;
              }
              const tmpYaml = sanitizeName(`${ob.name}_yaml`);
              const errName = `${tmpYaml}_err`;
              const jsonVar = sanitizeName(`${ob.name}_json`);
              expr = tmpYaml;
              const lines = [];
              lines.push(`char ${tmpYaml}[PYA_TEXT_CAP] = "";`);
              lines.push(`pya_yaml_error ${errName} = { "", 0, 0 };`);
              lines.push(`if (!pya_json_to_yaml(${jsonVar}, ${tmpYaml}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
              const writeFilename = sentence?.to?.filename;
              if (writeFilename) {
                const safePath = JSON.stringify(writeFilename);
                const fileVar = `out_${cState?.fileCounter ?? 0}`;
                if (cState) cState.fileCounter += 1;
                lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
                lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpYaml}); fclose(${fileVar}); }`);
                if (!isWrite) lines.push(`printf("%s\\n", ${tmpYaml});`);
              } else {
                lines.push(`printf("%s\\n", ${tmpYaml});`);
              }
              return lines.join("\n");
            }
          } else {
            if (jsHelpers) {
              jsHelpers.usesYamlStringify = true;
              jsHelpers.usesJsonMap = true;
            }
            expr = `yamlStringifyRuntime(jsonFromMap(${JSON.stringify(ob.name)}))`;
          }
        } else if (mapDefs?.has(ob.name)) {
          const chain = mapDefChainFromName(ob.name, mapDefs, { formatter: mapSentenceToPyash });
          expr = JSON.stringify(chain);
        }
      }
      if (isCsvMap && !wantCsv) {
        const chain = mapDefs?.has(ob.name)
          ? mapDefChainFromName(ob.name, mapDefs, { formatter: mapSentenceToPyash })
          : "";
        if (lang === "c") {
          if (mapDefs?.has(ob.name)) {
            expr = JSON.stringify(chain);
          } else {
            if (cHelpers) {
              cHelpers.usesCsvRuntime = true;
              cHelpers.usesStdlib = true;
              cHelpers.usesString = true;
              cHelpers.usesCtype = true;
              cHelpers.usesPrintf = true;
            }
            if (sentence?.to?.filename) {
              const safePath = JSON.stringify(sentence.to.filename);
              if (cHelpers) cHelpers.usesExchange = true;
              cState.evokeCounter = (cState.evokeCounter ?? -1) + 1;
              return `pya_csv_write_pyash_file(${JSON.stringify(ob.name)}, ${safePath});\npya_exchange_record_file(${safePath}, "write", ${JSON.stringify(sentenceIdForText(sentenceToPyash(sentence), cState.evokeCounter))});`;
            }
            return `pya_csv_write_pyash_stdout(${JSON.stringify(ob.name)});`;
          }
        } else {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          const mapExpr = (locals?.has(name) || declared?.has(name)) ? name : `remember(${JSON.stringify(ob.name)})`;
          expr = `formatMapSentence(${JSON.stringify(ob.name)}, ${mapExpr})`;
        }
      }
      if (isCsvMap && wantCsv) {
        if (lang === "c") {
          const mapSentence = mapDefs?.get(ob.name);
          if (mapSentence && mapSentence.be === "csv map") {
            expr = JSON.stringify(csvTextFromMapSentence(mapSentence));
          } else {
            if (cHelpers) {
              cHelpers.usesCsvRuntime = true;
              cHelpers.usesStdlib = true;
              cHelpers.usesString = true;
              cHelpers.usesCtype = true;
              cHelpers.usesPrintf = true;
            }
            if (sentence?.to?.filename) {
              const safePath = JSON.stringify(sentence.to.filename);
              if (cHelpers) cHelpers.usesExchange = true;
              cState.evokeCounter = (cState.evokeCounter ?? -1) + 1;
              return `pya_csv_write_file(${JSON.stringify(ob.name)}, ${safePath});\npya_exchange_record_file(${safePath}, "write", ${JSON.stringify(sentenceIdForText(sentenceToPyash(sentence), cState.evokeCounter))});`;
            }
            return `pya_csv_write_stdout(${JSON.stringify(ob.name)});`;
          }
        } else {
          if (jsHelpers) jsHelpers.usesCsvMap = true;
          expr = `formatCsvMap(${JSON.stringify(ob.name)})`;
        }
      }
      if (!isJsonMap && !isMap && !isCsvMap && lang === "c" && (locals?.has(name) || declared?.has(name) || declared?.has(ob.name))) {
        expr = name;
      } else if (!isJsonMap && !isMap && !isCsvMap && locals?.has(name)) {
        if (declaredTypes?.get(ob.name) === "vector") {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatVectorSentence(${JSON.stringify(ob.name)}, ${name}.ob?.ve ?? ${name}.ve)`;
        } else if (isSentence) {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatSentence(${name})`;
        } else {
          expr = `${name}.ob?.ve?.values ?? ${name}.ob?.text ?? ${name}.ob?.num ?? ${name}.ob?.date`;
        }
      } else if (!isJsonMap && !isMap && !isCsvMap && declared?.has(name)) {
        if (declaredTypes?.get(ob.name) === "vector") {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatVectorSentence(${JSON.stringify(ob.name)}, ${name}.ob?.ve ?? ${name}.ve)`;
        } else if (isSentence) {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatSentence(${name})`;
        } else {
          expr = `${name}.ob?.ve?.values ?? ${name}.ob?.text ?? ${name}.ob?.num ?? ${name}.ob?.date`;
        }
      } else if (!isJsonMap && !isMap && !isCsvMap && isSentence) {
        if (jsHelpers) jsHelpers.usesVectorFormat = true;
        expr = `formatSentence(remember(${JSON.stringify(ob.name)}))`;
        if (rememberFlag) rememberFlag.used = true;
      } else if (!isJsonMap && !isMap && !isCsvMap) {
        expr = JSON.stringify(ob.name);
      }
    } else {
      const fallback = exprForSlot(ob, {
        sentenceArg,
        locals,
        declared,
        defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text ?? ${sentenceArg}.ob?.num` : undefined,
        field: "text"
      });
      if (fallback) expr = fallback;
    }
  }
  if (expr === "undefined" && typeof ob.date === "string") {
    expr = JSON.stringify(ob.date);
  }
  const writeFilename = sentence?.to?.filename;
  if (writeFilename && lang !== "c") {
    if (jsHelpers) {
      jsHelpers.usesFs = true;
      jsHelpers.usesExchange = true;
    }
    const writeLine = jsHelpers?.usesExchange
      ? `pyaWriteTextFile(${JSON.stringify(writeFilename)}, ${expr}, "write", ${JSON.stringify(sentenceId)});`
      : `fs.writeFileSync(${JSON.stringify(writeFilename)}, String(${expr}));`;
    return isWrite ? writeLine : `${writeLine}\nconsole.log(${expr});`;
  }
  if (lang === "c") {
    return handleCWriteOutput({
      sentence,
      ob,
      expr,
      wantCsv,
      wantYaml,
      isWrite,
      declaredTypes,
      localsTypes,
      locals,
      declared,
      cHelpers,
      cState,
      sentenceId
    }, {
      sanitizeName
    });
  }
  return `console.log(${expr});`;
}
