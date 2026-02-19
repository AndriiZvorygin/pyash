import YAML from "yaml";

export function handleMapDefinition(context, helpers) {
  const {
    sentence,
    sentences,
    index,
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
  } = context;
  const {
    throwErrorSentence,
    jsonFromMapSentence,
    canonicalJsonStringify,
    canonicalizeJsonValue,
    normalizeJsonMapError,
    csvTextFromMapSentence,
    sanitizeName,
    sentenceToPyash,
    markDeclared
  } = helpers;

  if (sentence.mood !== "def" || (sentence.be !== "map" && sentence.be !== "json map" && sentence.be !== "csv map")) {
    return null;
  }

  const body = [];
  let j = index + 1;
  for (; j < sentences.length; j++) {
    if (sentences[j].mood === "prah") break;
    body.push(sentences[j]);
  }
  const map = {};
  const seen = new Set();
  for (const entry of body) {
    const key = entry?.su?.name ?? entry?.su?.text;
    if (sentence.be === "map") {
      if (!key) {
        throwErrorSentence({
          name: "pyash map sentence lost su",
          message: "pyash map sentence lost su",
          from: { name: "compile" },
          raw: entry
        });
      }
      if (seen.has(key)) {
        throwErrorSentence({
          name: "pyash map switch excess",
          message: "pyash map switch excess",
          from: { name: "compile" },
          raw: { name: key }
        });
      }
      seen.add(key);
    }
    if (sentence.be === "json map") {
      if (!key) {
        throwErrorSentence({
          name: "json map sentence lost su",
          message: "json map sentence lost su",
          from: { name: "compile" },
          raw: entry
        });
      }
      if (entry?.ob === undefined) {
        throwErrorSentence({
          name: "json map sentence lost ob",
          message: "json map sentence lost ob",
          from: { name: "compile" },
          raw: entry
        });
      }
    }
    if (!key) continue;
    map[key] = sentence.be === "map" ? entry : (entry.ob ?? {});
  }
  const mapSentence = {
    mood: "ya",
    su: { name },
    be: sentence.be,
    ob: { map }
  };
  mapDefs.set(name, mapSentence);

  if (collectSourceMap && sourceLineFor(index)) {
    lines.push(`// @pyash-line ${sourceLineFor(index)}`);
  }
  if (lang === "c" && sourceLineFor(index) && sourceFilename) {
    lines.push(`#line ${sourceLineFor(index)} "${sourceFilename}"`);
  }

  if (sentence.be === "json map") {
    try {
      const jsonObj = jsonFromMapSentence(mapSentence, mapDefs, new Set());
      cState.jsonMapStrings.set(name, canonicalJsonStringify(jsonObj));
      cState.jsonMapPrettyStrings.set(name, JSON.stringify(jsonObj, null, 2));
      cState.yamlMapStrings.set(name, YAML.stringify(canonicalizeJsonValue(jsonObj)));
    } catch (err) {
      const normalized = normalizeJsonMapError(err);
      throwErrorSentence({
        name: normalized.name,
        message: normalized.message,
        from: { name: "compile" },
        raw: { name, error: err?.message }
      });
    }
  }
  if (sentence.be === "csv map") {
    try {
      const csvText = csvTextFromMapSentence(mapSentence);
      cState.csvMapStrings.set(name, csvText);
    } catch (err) {
      throwErrorSentence({
        name: "csv columns defective",
        message: err?.message ?? "csv columns defective",
        from: { name: "compile" },
        raw: { name, error: err?.message }
      });
    }
  }

  if (lang === "c") {
    if (sentence.be !== "csv map") {
      cHelpers.usesMap = true;
      cHelpers.usesMapGlobals = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesCtype = true;
      const mapVar = sanitizeName(name);
      const priorType = declaredTypes.get(name);
      const mapAlreadyDeclared = declared.has(name) && (
        priorType === "map" || priorType === "json map" || priorType === "csv map"
      );
      if (!mapAlreadyDeclared) {
        lines.push(`pya_map ${mapVar} = {0, 0, NULL};`);
      }
      mainLines.push(`pya_map_init(&${mapVar});`);
      for (const [key, value] of Object.entries(map)) {
        if (sentence.be === "map" && value && typeof value === "object" && value.mood) {
          const pyashText = sentenceToPyash(value);
          mainLines.push(`pya_map_set_sentence(&${mapVar}, ${JSON.stringify(key)}, ${JSON.stringify(pyashText)});`);
        } else if (value?.num !== undefined) {
          const numVal = Number(value.num);
          mainLines.push(`pya_map_set_num(&${mapVar}, ${JSON.stringify(key)}, ${Number.isNaN(numVal) ? 0 : numVal});`);
        } else if (value?.text !== undefined) {
          mainLines.push(`pya_map_set_text(&${mapVar}, ${JSON.stringify(key)}, ${JSON.stringify(String(value.text))});`);
        } else if (value?.boolean !== undefined) {
          mainLines.push(`pya_map_set_bool(&${mapVar}, ${JSON.stringify(key)}, ${value.boolean ? 1 : 0});`);
        } else if (value?.hollow) {
          mainLines.push(`pya_map_set_hollow(&${mapVar}, ${JSON.stringify(key)});`);
        }
      }
    }
    if (sentence.be === "json map") {
      const jsonText = cState.jsonMapStrings.get(name);
      if (jsonText) {
        const varName = sanitizeName(`${name}_json`);
        lines.push(`const char *${varName} = ${JSON.stringify(jsonText)};`);
      }
      const prettyText = cState.jsonMapPrettyStrings.get(name);
      if (prettyText) {
        const varName = sanitizeName(`${name}_json_pretty`);
        lines.push(`const char *${varName} = ${JSON.stringify(prettyText)};`);
      }
      const yamlText = cState.yamlMapStrings.get(name);
      if (yamlText) {
        const varName = sanitizeName(`${name}_yaml`);
        lines.push(`const char *${varName} = ${JSON.stringify(yamlText)};`);
      }
    }
    if (sentence.be === "csv map") {
      const csvText = cState.csvMapStrings.get(name);
      if (csvText) {
        const varName = sanitizeName(`${name}_csv`);
        lines.push(`const char *${varName} = ${JSON.stringify(csvText)};`);
      }
    }
  } else {
    const varName = sanitizeName(name);
    const payload = JSON.stringify(mapSentence);
    const mapAlreadyDeclared = declared.has(name);
    if (mapAlreadyDeclared) {
      lines.push(`${varName} = ${payload};`);
    } else {
      lines.push(`let ${varName} = ${payload};`);
    }
    lines.push(`globalThis[${JSON.stringify(name)}] = ${varName};`);
  }

  if (name) {
    markDeclared(declared, name);
    declaredTypes.set(name, sentence.be);
  }

  return { endIndex: j };
}
