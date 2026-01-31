import { throwErrorSentence } from "../../../error.mjs";
import { handleMindWrite } from "./emit_write_mind.mjs";

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
  const formatParts = [];
  if (sentence?.become?.name) formatParts.push(sentence.become.name);
  if (sentence?.become?.text) formatParts.push(sentence.become.text);
  const formatRaw = formatParts.join(" ").trim().toLowerCase();
  const jsonMode = formatRaw.includes("json")
    ? (formatRaw.includes("beautiful") ? "pretty" : "canonical")
    : null;
  const wantJson = jsonMode !== null;
  const wantYaml = formatRaw.includes("yaml");
  const wantCsv = formatRaw.includes("csv");
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

  if (lang === "c" && ob.name && declaredTypes?.get(ob.name) === "map") {
    cHelpers.usesMap = true;
    cHelpers.usesMapPrinter = true;
    cHelpers.usesMapGlobals = true;
    cHelpers.usesPrintf = true;
    cHelpers.usesString = true;
    cHelpers.usesStdlib = true;
    cHelpers.usesCtype = true;
    return `print_map_sentence(${JSON.stringify(ob.name)}, &${sanitizeName(ob.name)});`;
  }

  const genChain = sentence.ob?.genitive?.chain || [];
  const wantsVector = genChain.at(-1) === "ve" || declaredTypes?.get(sentence.ob?.name) === "vector";

  if (lang === "c" && ob.name && declaredTypes?.get(ob.name) === "list") {
    if (cHelpers) {
      cHelpers.usesPrintf = true;
      cHelpers.usesVectorType = true;
      cHelpers.usesVectorPrinter = true;
      cHelpers.usesListPrinter = true;
      cHelpers.usesString = true;
      cHelpers.usesCtype = true;
    }
    return `print_list_sentence(${JSON.stringify(ob.name)}, &${sanitizeName(ob.name)});`;
  }

  if (lang === "c" && wantsVector) {
    if (cHelpers) {
      cHelpers.usesPrintf = true;
      cHelpers.usesVectorType = true;
      cHelpers.usesVectorPrinter = true;
      cHelpers.usesString = true;
      cHelpers.usesCtype = true;
    }
    const vecName = sentence.ob?.name;
    if (vecName && declaredTypes?.get(vecName) === "vector") {
      return `print_vec_sentence(${JSON.stringify(vecName)}, &${sanitizeName(vecName)});`;
    }
    if (sentence.ob?.genitive) {
      const chain = sentence.ob.genitive.chain || [];
      if (chain.length === 2 && chain[1] === "ve" && chain[0] !== "this") {
        const root = sanitizeName(chain[0]);
        if (locals?.has(root) || declared?.has(root)) return `print_vec(&${root});`;
      }
      const vecExpr = vectorExprFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared });
      if (vecExpr && !vecExpr.includes("remember(")) return `print_vec(${vecExpr});`;
    }
  }

  let expr = "undefined";
  let forcedExpr = false;
  if (lang !== "c" && wantJson) {
    const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
    const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
    if (!isJsonMap && isPyashText) {
      if (jsHelpers) jsHelpers.usesJsonRuntime = true;
      const sourceExpr = typeof ob.text === "string"
        ? JSON.stringify(ob.text)
        : `remember(${JSON.stringify(ob.name ?? "")})?.ob?.text ?? ""`;
      if (rememberFlag) rememberFlag.used = true;
      const rootName = JSON.stringify(sentence?.su?.name ?? "");
      const mode = jsonMode === "pretty" ? "pretty" : "canonical";
      expr = `pyashToJsonTextRuntime(${sourceExpr}, ${rootName}, ${JSON.stringify(mode)})`;
      forcedExpr = true;
    }
  }
  if (lang === "c" && wantJson) {
    const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
    const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
    if (!isJsonMap && isPyashText) {
      if (cHelpers) {
        cHelpers.usesJsonRuntime = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
        cHelpers.usesCtype = true;
      }
      const tmpName = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_json`);
      const errName = `${tmpName}_err`;
      const rootName = sentence?.su?.name ? JSON.stringify(sentence.su.name) : "NULL";
      const sourceExpr = typeof ob.text === "string"
        ? JSON.stringify(ob.text)
        : (ob.name ? sanitizeName(ob.name) : "NULL");
      const lines = [];
      lines.push(`char ${tmpName}[PYA_TEXT_CAP] = "";`);
      lines.push(`pya_json_error ${errName} = { "", 0, 0 };`);
      lines.push(`if (!pya_pyash_to_json(${sourceExpr}, ${rootName}, ${tmpName}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
      const writeFilename = sentence?.to?.filename;
      if (writeFilename) {
        const safePath = JSON.stringify(writeFilename);
        const fileVar = `out_${cState?.fileCounter ?? 0}`;
        if (cState) cState.fileCounter += 1;
        lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
        lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpName}); fclose(${fileVar}); }`);
        if (!isWrite) lines.push(`printf("%s\\n", ${tmpName});`);
      } else {
        lines.push(`printf("%s\\n", ${tmpName});`);
      }
      return lines.join("\n");
    }
  }
  if (!forcedExpr) {
    if (wantYaml && lang !== "c") {
      const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
      const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
      if (!isJsonMap && isPyashText) {
        if (jsHelpers) {
          jsHelpers.usesYamlStringify = true;
          jsHelpers.usesJsonRuntime = true;
          jsHelpers.usesVectorFormat = true;
        }
        const sourceExpr = typeof ob.text === "string"
          ? JSON.stringify(ob.text)
          : `remember(${JSON.stringify(ob.name ?? "")})?.ob?.text ?? ""`;
        if (rememberFlag) rememberFlag.used = true;
        const rootName = JSON.stringify(sentence?.su?.name ?? "");
        expr = `yamlStringifyRuntime(JSON.parse(pyashToJsonTextRuntime(${sourceExpr}, ${rootName}, "canonical")))`;
        forcedExpr = true;
      }
    } else if (wantYaml && lang === "c") {
      const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
      const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
      if (!isJsonMap && isPyashText) {
        if (cHelpers) {
          cHelpers.usesYamlStringify = true;
          cHelpers.usesJsonRuntime = true;
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesStdlib = true;
          cHelpers.usesPrintf = true;
          cHelpers.usesCtype = true;
        }
        const tmpJson = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_json`);
        const tmpYaml = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_yaml`);
        const errName = `${tmpYaml}_err`;
        const rootName = sentence?.su?.name ? JSON.stringify(sentence.su.name) : "NULL";
        const sourceExpr = typeof ob.text === "string"
          ? JSON.stringify(ob.text)
          : (ob.name ? sanitizeName(ob.name) : "NULL");
        const lines = [];
        lines.push(`char ${tmpJson}[PYA_TEXT_CAP] = "";`);
        lines.push(`char ${tmpYaml}[PYA_TEXT_CAP] = "";`);
        lines.push(`pya_json_error ${tmpJson}_err = { "", 0, 0 };`);
        lines.push(`if (!pya_pyash_to_json(${sourceExpr}, ${rootName}, ${tmpJson}, &${tmpJson}_err)) { fprintf(stderr, "%s\\n", ${tmpJson}_err.message); }`);
        lines.push(`pya_yaml_error ${errName} = { "", 0, 0 };`);
        lines.push(`if (!pya_json_to_yaml(${tmpJson}, ${tmpYaml}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
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
    if (cHelpers) cHelpers.usesPrintf = true;
    const isText = typeof ob.text === "string"
      || typeof ob.date === "string"
      || wantCsv
      || wantYaml
      || (ob.name && (declaredTypes?.get(ob.name) === "text" || declaredTypes?.get(ob.name) === "date" || declaredTypes?.get(ob.name) === "sentence" || declaredTypes?.get(ob.name) === "json map" || declaredTypes?.get(ob.name) === "map" || declaredTypes?.get(ob.name) === "csv map"))
      || (ob.name && (localsTypes?.get(sanitizeName(ob.name)) === "text" || localsTypes?.get(sanitizeName(ob.name)) === "date"))
      || (ob.name && !declaredTypes?.has(ob.name) && !(locals?.has(sanitizeName(ob.name)) || declared?.has(sanitizeName(ob.name)) || declared?.has(ob.name)));
    const fmt = (wantCsv || wantYaml) ? "%s" : (isText ? "%s" : "%g");
    if (writeFilename) {
      if (cHelpers) {
        cHelpers.usesStdlib = true;
        cHelpers.usesExchange = true;
        if (fmt === "%s") cHelpers.usesTextHelper = true;
      }
      const safePath = JSON.stringify(writeFilename);
      const fileVar = `out_${cState?.fileCounter ?? 0}`;
      if (cState) cState.fileCounter += 1;
      const writeLine = fmt === "%s"
        ? `pya_write_text_file(${safePath}, ${expr});\npya_exchange_record_file(${safePath}, "write", ${JSON.stringify(sentenceId)});`
        : `FILE *${fileVar} = fopen(${safePath}, "w");\nif (${fileVar}) { fprintf(${fileVar}, "${fmt}", ${expr}); fclose(${fileVar}); }\npya_exchange_record_file(${safePath}, "write", ${JSON.stringify(sentenceId)});`;
      if (isWrite) return writeLine;
      return (wantCsv || wantYaml) ? `${writeLine}\nprintf("%s", ${expr});` : `${writeLine}\nprintf("${fmt}\\n", ${expr});`;
    }
    return (wantCsv || wantYaml) ? `printf("%s", ${expr});` : `printf("${fmt}\\n", ${expr});`;
  }
  return `console.log(${expr});`;
}
