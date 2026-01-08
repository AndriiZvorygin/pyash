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
  const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
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
