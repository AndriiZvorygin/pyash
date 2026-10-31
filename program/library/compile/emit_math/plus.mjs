export function handleMathPlus(context, helpers) {
  const {
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
    rememberFlag,
    jsHelpers,
    mapDefs
  } = context;
  const {
    exprForSlot,
    sanitizeName,
    targetPath,
    vectorValuesExpr,
    lvalueForName,
    pathFromGenitive,
    cExpr,
    markDeclared
  } = helpers;

  // Text concatenation via add (numeric source)
  if (baseBe === "plus" && (sentence.to?.name || sentence.to?.genitive)) {
    const objExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    const objTextExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "text" });
    const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
    const targetIsText =
      targetName &&
      (localsTypes?.get(targetName) === "text" || declaredTypes?.get(targetName) === "text" || declaredTypes?.get(sentence.to?.name) === "text");
    const canUseTextExpr =
      typeof ob.text === "string" ||
      (ob?.name && (
        localsTypes?.get(sanitizeName(ob.name)) === "text" ||
        declaredTypes?.get(sanitizeName(ob.name)) === "text" ||
        declaredTypes?.get(ob.name) === "text"
      ));
    const valueExpr =
      (canUseTextExpr && objTextExpr !== null)
        ? (typeof ob.text === "string" ? JSON.stringify(ob.text) : `String(${objTextExpr})`)
        : (objExpr !== null ? `String(${objExpr})` : null);
    if (targetIsText && valueExpr !== null) {
      if (sentenceArg) {
        const target = (() => {
          if (sentence.to?.name) {
            const baseName = sanitizeName(sentence.to.name);
            if (locals?.has(baseName)) return `${baseName}.ob.text`;
            if (declaredTypes?.get(baseName) === "text") return `${baseName}.ob.text`;
          }
          return targetPath("to", sentenceArg, "text", sentence.to, { locals, declared }) ?? sentence.to?.name;
        })();
        const init = `${target} = ${target} ?? "";`;
        const concat = `${target} = ${target} + ${valueExpr};`;
        return `${init}\n${concat}`;
      }
      if (lang === "c") {
        if (cHelpers) {
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesPrintf = true;
        }
        const target = sanitizeName(sentence.to.name);
        const needsDecl = !locals?.has(target) && !declared?.has(target) && !declared?.has(sentence.to.name);
        const textExprRaw = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: "\"\"", field: "text" }) ?? "\"\"";
        const textExpr = cExpr(textExprRaw);
        const numExprRaw = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
        const numExpr = numExprRaw != null ? cExpr(numExprRaw) : null;
        const numericSourceExplicit =
          ob.num !== undefined ||
          (Array.isArray(ob?.genitive?.chain) && ob.genitive.chain.includes("num"));
        const appendLine = (typeof ob.text === "string" || canUseTextExpr)
          ? `pya_concat_buf(${target}, ${typeof ob.text === "string" ? JSON.stringify(ob.text) : textExpr});`
          : (numericSourceExplicit && numExpr != null
            ? `pya_concat_num_buf(${target}, ${numExpr});`
            : `pya_concat_buf(${target}, ${textExpr});`);
        if (needsDecl) {
          if (markDeclared) markDeclared(declared, sentence.to.name);
          if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
          return `char ${target}[PYA_TEXT_CAP] = \"\";\n${appendLine}`;
        }
        return appendLine;
      }
      if (!sentenceArg && sentence.to?.name && (!declared?.has(sentence.to.name) && !declared?.has(sanitizeName(sentence.to.name)))) {
        const declName = sanitizeName(sentence.to.name);
        if (markDeclared) markDeclared(declared, sentence.to.name);
        if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
        return `let ${declName} = { su: { name: ${JSON.stringify(sentence.to.name)} }, ob: {}, be: "text", mood: "ya" };\n${declName}.ob.text = (${declName}.ob.text ?? \"\") + ${valueExpr};\nglobalThis[${JSON.stringify(sentence.to.name)}] = ${declName};`;
      }
      return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.text = (${sentence.to.name}.ob.text ?? \"\") + ${valueExpr};`;
    }
  }

  // Imperative add
  if (baseBe === "plus" && ob.num !== undefined && sentenceArg && !sentence.to) {
    const increment = typeof ob.num === "number" ? ob.num : Number(ob.num);
    const safeInc = Number.isNaN(increment) ? 0 : increment;
    const lines = [];
    lines.push(`${sentenceArg}.ob = ${sentenceArg}.ob ?? {};`);
    lines.push(`const _target = ${sentenceArg}.ob?.ob ?? ${sentenceArg}.ob;`);
    lines.push(`_target.num = (_target.num ?? 0) + ${safeInc};`);
    return lines.join("\n");
  }

  if (baseBe === "plus" && ob.num !== undefined && (sentence.to?.name || sentence.to?.genitive)) {
    const mapName = sentence.to?.name;
    const targetType = mapName ? declaredTypes?.get(mapName) : null;
    if (mapName && (targetType === "map" || targetType === "json map" || mapDefs?.has(mapName))) {
      const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
      if (lang === "c") {
        cHelpers.usesMap = true;
        cHelpers.usesMapGlobals = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
        cHelpers.usesCtype = true;
        const mapVar = sanitizeName(mapName);
        const keyChain = sentence.su?.genitive?.chain;
        const keyTail = Array.isArray(keyChain) ? keyChain.at(-1) : null;
        const rawKey = (() => {
          if (sentence.su?.genitive) {
            return pathFromGenitive(sentence.su.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: true }) ?? "0";
          }
          if (sentence.su?.text !== undefined) return JSON.stringify(sentence.su.text);
          if (sentence.su?.num !== undefined) return String(Number.isNaN(Number(sentence.su.num)) ? 0 : Number(sentence.su.num));
          if (sentence.su?.boolean !== undefined) return sentence.su.boolean ? "1" : "0";
          if (sentence.su?.name) return JSON.stringify(sentence.su.name);
          return "0";
        })();
        const lines = [];
        let keyExpr = rawKey;
        if (keyTail === "num" || typeof sentence.su?.num !== "undefined") {
          lines.push("char _key_buf[64];");
          lines.push(`snprintf(_key_buf, sizeof(_key_buf), \"%g\", ${rawKey});`);
          keyExpr = "_key_buf";
        } else if (keyTail === "boolean" || typeof sentence.su?.boolean !== "undefined") {
          lines.push("char _key_buf[8];");
          lines.push(`snprintf(_key_buf, sizeof(_key_buf), \"%s\", (${rawKey}) ? \"truth\" : \"lie\");`);
          keyExpr = "_key_buf";
        }
        const addFn = targetType === "map" ? "pya_map_add_sentence_num" : "pya_map_add_num";
        lines.push(`${addFn}(&${mapVar}, ${keyExpr}, ${Number.isNaN(safeValue) ? 0 : safeValue});`);
        return lines.join("\n");
      }
      const mapVar = sanitizeName(mapName);
      const keyExpr = (() => {
        if (sentence.su?.genitive && sentenceArg) {
          return pathFromGenitive(sentence.su.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes }) ?? "undefined";
        }
        if (sentence.su?.text !== undefined) return JSON.stringify(sentence.su.text);
        if (sentence.su?.num !== undefined) return String(Number.isNaN(Number(sentence.su.num)) ? 0 : Number(sentence.su.num));
        if (sentence.su?.boolean !== undefined) return sentence.su.boolean ? "\"truth\"" : "\"lie\"";
        if (sentence.su?.name) return JSON.stringify(sentence.su.name);
        return "undefined";
      })();
      const lines = [];
      if (!locals?.has(mapVar) && !declared?.has(mapVar)) {
        lines.push(`const ${mapVar} = remember(${JSON.stringify(mapName)});`);
        locals?.add(mapVar);
      }
      lines.push(`${mapVar}.ob = ${mapVar}.ob ?? {};`);
      lines.push(`${mapVar}.ob.map = ${mapVar}.ob.map ?? {};`);
      lines.push(`const _key = String(${keyExpr});`);
      lines.push(`const _curr = ${mapVar}.ob.map[_key];`);
      if (targetType === "map") {
        lines.push("const _base = (_curr && typeof _curr === \"object\") ? _curr : { mood: \"ya\", su: { name: _key } };");
        lines.push("_base.ob = _base.ob ?? {};\n_base.ob.num = (typeof _base.ob.num === \"number\" ? _base.ob.num : 0) + " + (Number.isNaN(safeValue) ? 0 : safeValue) + ";");
        lines.push(`${mapVar}.ob.map[_key] = _base;`);
      } else {
        lines.push(`${mapVar}.ob.map[_key] = { num: (typeof _curr?.num === \"number\" ? _curr.num : 0) + ${Number.isNaN(safeValue) ? 0 : safeValue} };`);
      }
      return lines.join("\n");
    }
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      if (sentence.to?.name) {
        const localName = sanitizeName(sentence.to.name);
        if (locals?.has(localName)) {
          const inc = Number.isNaN(safeValue) ? 0 : safeValue;
          const lines = [];
          lines.push(`${localName}.ob = ${localName}.ob?.ob ?? ${localName}.ob ?? {};`);
          lines.push(`${localName}.ob.num = (${localName}.ob.num ?? 0) + ${inc};`);
          return lines.join("\n");
        }
      }
      const genitiveChain = sentence.to?.genitive?.chain || [];
      const genitiveHint = genitiveChain.find(part => part !== "this");
      const targetNameLiteral = sentence.to?.name
        ? `\"${sentence.to.name}\"`
        : genitiveHint
          ? `\"${genitiveHint}\"`
          : sentence.su?.name
            ? `\"${sentence.su.name}\"`
            : "\"\"";
      const targetVarName = sanitizeName((sentence.to?.name || genitiveHint || sentence.su?.name || "sentence"));
      const isThisGenitive = sentence.to?.genitive?.chain?.[0] === "this";
      const targetVar = isThisGenitive ? sentenceArg : targetVarName || "sentence";
      const targetExpr = sentence.to
        ? isThisGenitive
          ? sentenceArg
          : `${sentenceArg}.to ?? { su: { name: ${targetNameLiteral} }, ob: {} }`
        : sentenceArg;
      const lines = [];
      if (!isThisGenitive && !locals?.has(targetVar) && !declared?.has(targetVar)) {
        lines.push(`const ${targetVar} = remember(${targetExpr});`);
        locals?.add(targetVar);
      }
      lines.push(`${targetVar}.ob = ${targetVar}.ob?.ob ?? ${targetVar}.ob ?? {};`);
      const targetChain = sentence.to?.genitive?.chain || [];
      let fieldPath = `${targetVar}.ob.num`;
      if (sentence.to?.genitive) {
        const root = sanitizeName(String(targetChain[0] ?? ""));
        const localNumericTarget =
          root &&
          targetChain.at(-1) === "num" &&
          targetChain.includes("ob") &&
          (root === targetVar || locals?.has(root) || declared?.has(root));
        fieldPath = localNumericTarget
          ? `${root}.ob.num`
          : (pathFromGenitive(sentence.to.genitive, targetVar, { locals, declared }) || `${targetVar}.ob.num`);
      }
      const newVal = `${fieldPath} ?? 0`;
      lines.push(`${fieldPath} = (${newVal}) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      const target = sentence.to?.genitive
        ? (pathFromGenitive(sentence.to.genitive, undefined, { locals, declared, allowCGlobals: true }) ?? "")
        : sanitizeName(sentence.to?.name);
      if (!target) {
        return `// TODO: ${JSON.stringify(sentence)}`;
      }
      const needsDecl = sentence.to?.name && !locals?.has(target) && !declared?.has(target) && !declared?.has(sentence.to.name);
      const init = needsDecl ? `double ${target} = 0;\n` : "";
      if (needsDecl) {
        if (markDeclared) markDeclared(declared, sentence.to.name);
        if (declaredTypes) declaredTypes.set(sentence.to.name, "number");
      }
      return `${init}${target} = ${target} + ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const lines = [];
    if (sentence.to?.name && !declared?.has(sentence.to.name) && !declared?.has(sanitizeName(sentence.to.name))) {
      const declName = sanitizeName(sentence.to.name);
      if (markDeclared) markDeclared(declared, sentence.to.name);
      if (declaredTypes) declaredTypes.set(sentence.to.name, "number");
      lines.push(`let ${declName} = { su: { name: ${JSON.stringify(sentence.to.name)} }, ob: {}, be: "number", mood: "ya" };`);
      lines.push(`globalThis[${JSON.stringify(sentence.to.name)}] = ${declName};`);
      lines.push(`${declName}.ob.num = (${declName}.ob.num ?? 0) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
      return lines.join("\n");
    }
    lines.push(`${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};`);
    lines.push(`${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
    return lines.join("\n");
  }

  // Text concatenation via add
  if (baseBe === "plus" && (ob.text !== undefined || ob.genitive || ob.name) && (sentence.to?.name || sentence.to?.genitive)) {
    const valueExpr = exprForSlot(ob, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: null,
      field: "text"
    });
    const literal = typeof ob.text === "string" ? JSON.stringify(ob.text) : null;
    const textExpr = valueExpr ?? literal ?? "\"\"";
    if (sentenceArg) {
      const target = (() => {
        if (sentence.to?.name) {
          const baseName = sanitizeName(sentence.to.name);
          if (locals?.has(baseName)) return `${baseName}.ob.text`;
        }
        return targetPath("to", sentenceArg, "text", sentence.to, { locals, declared }) ?? sentence.to?.name;
      })();
      const init = `${target} = ${target} ?? "";`;
      const concat = `${target} = ${target} + ${textExpr};`;
      return `${init}\n${concat}`;
    }
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
      }
      const cTextExpr = cExpr(textExpr);
      if (sentence.to?.genitive) {
        const target = pathFromGenitive(sentence.to.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
        if (target) return `pya_concat_buf(${target}, ${cTextExpr});`;
      }
      const target = sanitizeName(sentence.to.name);
      const needsDecl = sentence.to?.name && !locals?.has(target) && !declared?.has(target) && !declared?.has(sentence.to.name);
      const decl = needsDecl ? `char ${target}[PYA_TEXT_CAP] = \"\";\n` : "";
      if (needsDecl) {
        if (markDeclared) markDeclared(declared, sentence.to.name);
        if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
      }
      return `${decl}pya_concat_buf(${target}, ${cTextExpr});`;
    }
    if (!sentenceArg && sentence.to?.name && (!declared?.has(sentence.to.name) && !declared?.has(sanitizeName(sentence.to.name)))) {
      const declName = sanitizeName(sentence.to.name);
      if (markDeclared) markDeclared(declared, sentence.to.name);
      if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
      return `let ${declName} = { su: { name: ${JSON.stringify(sentence.to.name)} }, ob: {}, be: "text", mood: "ya" };\n${declName}.ob.text = (${declName}.ob.text ?? \"\") + ${textExpr};\nglobalThis[${JSON.stringify(sentence.to.name)}] = ${declName};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.text = (${sentence.to.name}.ob.text ?? \"\") + ${textExpr};`;
  }

  return null;
}
