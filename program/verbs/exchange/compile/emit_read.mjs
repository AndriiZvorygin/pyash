const READ_COMMANDS = {
  html: {
    text: {
      prefix: "pandoc --from=html --to=plain --wrap=none \"",
      suffix: "\""
    },
    markdown: {
      prefix: "pandoc --from=html-native_divs-native_spans --to=gfm --wrap=none \"",
      suffix: "\" | sed -e 's/<span[^>]*><\\\\/span>//g'"
    },
    markdownPlain: {
      prefix: "pandoc --from=html-native_divs-native_spans --to=markdown --wrap=none \"",
      suffix: "\" | sed -e 's/<span[^>]*><\\\\/span>//g'"
    }
  },
  pdf: {
    text: {
      prefix: "pdftotext -layout \"",
      suffix: "\" -"
    },
    markdown: {
      prefix: "pdftohtml -stdout -i -q \"",
      suffix: "\" | pandoc --from=html-native_divs-native_spans --to=gfm --wrap=none | sed -e 's/<span[^>]*><\\\\/span>//g' -e '/^-----/d'"
    },
    markdownPlain: {
      prefix: "pdftohtml -stdout -i -q \"",
      suffix: "\" | pandoc --from=html-native_divs-native_spans --to=markdown --wrap=none | sed -e 's/<span[^>]*><\\\\/span>//g' -e '/^-----/d'"
    }
  }
};

function resolveStateValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.wo) return String(value.wo);
  if (value?.name) return String(value.name);
  return "";
}

export function handleReadSentence(context, helpers) {
  const {
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
  } = context;
  const {
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
  } = helpers;

  if (baseBe !== "read") return null;

  cState.evokeCounter = (cState.evokeCounter ?? -1) + 1;
  const sentenceId = sentenceIdForText(sentenceToPyash(sentence), cState.evokeCounter);
  const sourceState = resolveStateValue(sentence?.fromstate).toLowerCase();
  const becomeState = resolveStateValue(sentence?.become).toLowerCase();
  if (sourceState === "html" || sourceState === "pdf") {
    const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
    const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
    if (!sourceFilename) return null;
    const wantsMarkdown = becomeState.startsWith("markdown");
    const wantsPlain = becomeState.includes("plain");
    const wantsText = becomeState === "text" || !becomeState;
    let commandSpec = null;
    if (wantsMarkdown && wantsPlain) commandSpec = READ_COMMANDS[sourceState].markdownPlain;
    else if (wantsMarkdown) commandSpec = READ_COMMANDS[sourceState].markdown;
    else if (wantsText) commandSpec = READ_COMMANDS[sourceState].text;
    if (!commandSpec) return null;
    const safeName = sanitizeName(targetName);
    const alreadyDeclared = declared?.has(targetName);
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    const cmd = `${commandSpec.prefix}${sourceFilename}${commandSpec.suffix}`;
    if (lang !== "c") {
      if (jsHelpers) {
        jsHelpers.usesCommand = true;
        jsHelpers.usesExchange = true;
      }
      const assignLine = alreadyDeclared
        ? `${safeName} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: String(__pyaOut ?? \"\") }, be: "text", mood: "ya" };`
        : `const ${safeName} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: String(__pyaOut ?? \"\") }, be: "text", mood: "ya" };`;
      const evoked = JSON.stringify(sentenceToPyash(sentence));
      const toolTarget = JSON.stringify(targetName);
      return [
        "{",
        `const __pyaToolEvoked = ${evoked};`,
        `const __pyaCmd = ${JSON.stringify(cmd)};`,
        "let __pyaOut;",
        "try {",
        "  __pyaOut = pyaCommand(__pyaCmd);",
        "} catch (err) {",
        "  const __pyaMsg = `command defective: ${String(err?.message ?? \"command defective\")}`;",
        "  pyaEmitNewspaper(`su name command defective ob text ${JSON.stringify(__pyaMsg)} from la ${__pyaToolEvoked} ko be error ya`);",
        "  throw err;",
        "}",
        assignLine,
        `globalThis[${JSON.stringify(targetName)}] = ${safeName};`,
        `const __pyaToolResult = "su name " + ${toolTarget} + " ob text " + JSON.stringify(String(__pyaOut ?? \"\")) + " be text ya";`,
        "pyaEmitNewspaper(`su name tool event ${pyaNextToolEventId()} ob la ${__pyaToolEvoked} ko to la ${__pyaToolResult} ko be tool ya`);",
        "}"
      ].join("\n");
    }
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesCommand = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
        cHelpers.usesExchange = true;
      }
      const evoked = JSON.stringify(sentenceToPyash(sentence));
      const toolTarget = JSON.stringify(targetName);
      const outVar = `read_out_${cState?.fileCounter ?? 0}`;
      if (cState) cState.fileCounter += 1;
      const lines = [];
      if (!locals?.has(safeName) && !alreadyDeclared) {
        lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
      }
      lines.push(`const char *__pyaCmd = ${JSON.stringify(cmd)};`);
      lines.push(`char *${outVar} = pya_command(__pyaCmd);`);
      lines.push(`if (!${outVar}) { char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\\\\"command defective\\\\\\" from la %s ko be error ya", ${evoked}); pya_emit_exchange(__pyaErr); exit(1); }`);
      lines.push(`snprintf(${safeName}, sizeof(${safeName}), "%s", ${outVar} ? ${outVar} : "");`);
      lines.push(`{ char __pyaEsc[PYA_TEXT_CAP]; pya_escape_text(${outVar} ? ${outVar} : "", __pyaEsc, sizeof(__pyaEsc)); char __pyaEvent[PYA_TEXT_CAP]; snprintf(__pyaEvent, sizeof(__pyaEvent), "su name tool event %06d ob la %s ko to la su name %s ob text \\\\\\"%s\\\\\\" be text ya ko be tool ya", pya_next_tool_event_id(), ${evoked}, ${toolTarget}, __pyaEsc); pya_emit_exchange(__pyaEvent); }`);
      lines.push(`if (${outVar}) free(${outVar});`);
      return lines.join("\n");
    }
  }
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
      } else {
        lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
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
      `try { ${parseVar} = JSON.parse(${sourceExpr}); } catch (err) { throw new Error("read: invalid json"); }`,
      assignLine,
      `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
    ].join("\n");
  }
  if (sourceState === "yaml") {
    const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
    const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
    const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
    if (!sourceFilename && typeof sourceText !== "string") return null;
    const safeName = sanitizeName(targetName);
    const alreadyDeclared = declared?.has(targetName);
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    if (lang !== "c" && !sourceFilename && typeof sourceText === "string") {
      let parsed;
      try {
        parsed = parseYamlToJsonValue(sourceText, { source: "compile yaml" });
      } catch (err) {
        throw err;
      }
      parsed = canonicalizeJsonValue(parsed);
      let text;
      try {
        text = jsonToPyashText(parsed, targetName).text;
      } catch (err) {
        throwErrorSentence({
          name: "yaml defective",
          message: err?.message ?? "yaml defective",
          from: { name: "compile" },
          raw: { error: err?.message }
        });
      }
      const assignLine = alreadyDeclared
        ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: ${JSON.stringify(text)} }, be: "pyash", mood: "ya" };`
        : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: ${JSON.stringify(text)} }, be: "pyash", mood: "ya" };`;
      return [
        assignLine,
        `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
      ].join("\n");
    }
    if (lang === "c") {
      if (!sourceFilename && typeof sourceText === "string") {
        let parsed;
        try {
          parsed = parseYamlToJsonValue(sourceText, { source: "compile yaml" });
        } catch (err) {
          throw err;
        }
        parsed = canonicalizeJsonValue(parsed);
        let text;
        try {
          text = jsonToPyashText(parsed, targetName).text;
        } catch (err) {
          throwErrorSentence({
            name: "yaml defective",
            message: err?.message ?? "yaml defective",
            from: { name: "compile" },
            raw: { error: err?.message }
          });
        }
        if (cHelpers) {
          cHelpers.usesPrintf = true;
          cHelpers.usesString = true;
          cHelpers.usesTextHelper = true;
        }
        const lines = [];
        const needsDecl = !locals?.has(safeName) && !alreadyDeclared;
        if (needsDecl) {
          lines.push(`char ${safeName}[PYA_TEXT_CAP] = "";`);
        }
        lines.push(`snprintf(${safeName}, PYA_TEXT_CAP, "%s", ${JSON.stringify(text)});`);
        return lines.join("\n");
      }
      if (cHelpers) {
        cHelpers.usesYamlRuntime = true;
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
        lines.push(`if (!pya_read_file_text(${JSON.stringify(sourceFilename)}, ${sourceVar})) { fprintf(stderr, "read: yaml lost\\n"); }`);
        lines.push(`pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)});`);
      } else {
        lines.push(`snprintf(${sourceVar}, PYA_TEXT_CAP, "%s", ${JSON.stringify(sourceText)});`);
      }
      lines.push(`pya_yaml_error ${safeName}_err = { "", 0, 0 };`);
      lines.push(`if (!pya_yaml_to_pyash(${sourceVar}, ${JSON.stringify(targetName)}, ${safeName}, &${safeName}_err)) { fprintf(stderr, "%s\\n", ${safeName}_err.message); }`);
      return lines.join("\n");
    }
    if (jsHelpers) {
      jsHelpers.usesYamlRuntime = true;
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
    const assignLine = alreadyDeclared
      ? `${safeName} = { su: { name: "${targetName}" }, ob: { text: yamlToPyashTextRuntime(${sourceExpr}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`
      : `const ${safeName} = { su: { name: "${targetName}" }, ob: { text: yamlToPyashTextRuntime(${sourceExpr}, ${JSON.stringify(targetName)}) }, be: "pyash", mood: "ya" };`;
    return [
      assignLine,
      `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
    ].join("\n");
  }
  if (sourceState === "csv") {
    const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
    const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
    if (typeof sourceText !== "string" && !sourceFilename) {
      return null;
    }
    if (typeof sourceText !== "string" && sourceFilename && lang !== "c") {
      const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
      const safeName = sanitizeName(targetName);
      markDeclared(declared, targetName);
      if (declaredTypes) declaredTypes.set(targetName, "csv map");
      if (jsHelpers) {
        jsHelpers.usesCsvRuntime = true;
        jsHelpers.usesCsvMap = true;
        if (sourceFilename) {
          jsHelpers.usesFs = true;
          jsHelpers.usesExchange = true;
        }
      }
      const sourceExpr = jsHelpers?.usesExchange
        ? `pyaReadTextFile(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)})`
        : `fs.readFileSync(${JSON.stringify(sourceFilename)}, "utf8")`;
      return [
        `const ${safeName} = csvMapFromTextRuntime(${sourceExpr}, ${JSON.stringify(targetName)});`,
        `globalThis[${JSON.stringify(targetName)}] = ${safeName};`
      ].join("\n");
    }
    if (typeof sourceText !== "string" && sourceFilename && lang === "c") {
      const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
      if (cHelpers) {
        cHelpers.usesCsvRuntime = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
        cHelpers.usesPrintf = true;
      }
      markDeclared(declared, targetName);
      if (declaredTypes) declaredTypes.set(targetName, "csv map");
      const errName = `csv_err_${cState?.csvCounter ?? 0}`;
      if (cState) cState.csvCounter += 1;
      if (cHelpers) cHelpers.usesExchange = true;
      return `pya_csv_error ${errName} = { \"\", 0, 0 }; if (!pya_csv_read_file(${JSON.stringify(sourceFilename)}, ${JSON.stringify(targetName)}, &${errName})) { fprintf(stderr, \"%s\\n\", ${errName}.message); } pya_exchange_record_file(${JSON.stringify(sourceFilename)}, "read", ${JSON.stringify(sentenceId)});`;
    }
    const normalizedText = sourceText
      .replace(/\r\n/g, "\r\n")
      .replace(/\n/g, "\n")
      .replace(/\r/g, "\r");
    const targetName = sentence?.to?.name ?? sentence?.su?.name ?? "result";
    let parsed;
    try {
      parsed = parseCsvText(normalizedText, { source: "compile csv" });
    } catch (err) {
      throw err;
    }
    const map = {
      "header raw": { ve: { type: "text", values: parsed.headerRaw } },
      header: { ve: { type: "text", values: parsed.header } }
    };
    parsed.header.forEach((key, idx) => {
      map[key] = { ve: { type: "text", values: parsed.columns[idx] } };
    });
    const mapSentence = {
      mood: "ya",
      su: { name: targetName },
      be: "csv map",
      ob: { map }
    };
    mapDefs?.set(targetName, mapSentence);
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "csv map");
    if (lang === "c") {
      try {
        const csvText = csvTextFromMapSentence(mapSentence);
        if (cState?.csvMapStrings) cState.csvMapStrings.set(targetName, csvText);
      } catch (err) {
        throwErrorSentence({
          name: "csv columns defective",
          message: err?.message ?? "csv columns defective",
          from: { name: "compile" },
          raw: { name: targetName, error: err?.message }
        });
      }
      return "/* csv read compile-time */";
    }
    const safeName = sanitizeName(targetName);
    const payload = JSON.stringify(mapSentence);
    return `const ${safeName} = ${payload};\nglobalThis[${JSON.stringify(targetName)}] = ${safeName};`;
  }

  return null;
}
