export function handleMathSentence(context, helpers) {
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
    loopShim,
    mindShim,
    cHelpers,
    rememberFlag,
    jsHelpers,
    cState,
    mapDefs
  } = context;
  const {
    exprForSlot,
    sanitizeName,
    targetPath,
    transpileSentence,
    vectorValuesExpr,
    lvalueForName,
    pathFromGenitive,
    cExpr
  } = helpers;

  // Conditionals (tiny/giant/equally) with then consequence
  if (sentence.consequence && (baseBe === "tiny" || baseBe === "giant" || baseBe === "equally")) {
    const lhsSlot =
      (ob && (ob.name || ob.num !== undefined || ob.text !== undefined || ob.genitive || ob.thisRef))
        ? ob
        : (sentence.su?.name ? { name: sentence.su.name } : ob);
    const comparesText =
      lhsSlot?.text !== undefined ||
      sentence.from?.text !== undefined ||
      (lhsSlot?.name && localsTypes?.get(sanitizeName(lhsSlot.name)) === "text");
    const lhs = (() => {
      if (lhsSlot?.name) {
        const baseName = sanitizeName(lhsSlot.name);
        if (locals?.has(baseName)) {
          return comparesText ? `${baseName}.ob?.text` : `${baseName}.ob?.num ?? ${baseName}`;
        }
      }
      return exprForSlot(lhsSlot, {
        sentenceArg,
        locals,
        declared,
        defaultExpr: sentenceArg ? (comparesText ? `${sentenceArg}.ob?.text` : `${sentenceArg}.ob?.num`) : "lhs",
        field: comparesText ? "text" : "num"
      }) ?? "lhs";
    })();
    const rhs = exprForSlot(sentence.from, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: sentenceArg ? (comparesText ? `${sentenceArg}.from?.text` : `${sentenceArg}.from?.num`) : "rhs",
      field: comparesText ? "text" : "num"
    }) ?? "rhs";
    const op = baseBe === "tiny" ? "<" : baseBe === "giant" ? ">" : (lang === "c" ? "==" : "===");
    const consequence = sentence.consequence;
    const body = transpileSentence(consequence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs }) ?? `// TODO: ${JSON.stringify(consequence)}`;
    const finalBody = body.split("\n").map(l => (l ? `  ${l}` : l)).join("\n");
    const cLhs = lang === "c"
      ? String(lhs)
          .replace(/\?\./g, ".")
          .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
          .replace(/\s*\?\?\s*[^)]+/g, "")
      : lhs;
    const cRhs = lang === "c"
      ? String(rhs)
          .replace(/\?\./g, ".")
          .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
          .replace(/\s*\?\?\s*[^)]+/g, "")
      : rhs;
    const jsLhs = `(${lhs})`;
    const jsRhs = `(${rhs})`;
    const cLhsWrapped = `(${cLhs})`;
    const cRhsWrapped = `(${cRhs})`;
    if (lang === "c" && comparesText && baseBe === "equally") {
      return `if (strcmp(${cLhsWrapped}, ${cRhsWrapped}) == 0) {\n${finalBody}\n}`;
    }
    return `if (${lang === "c" ? cLhsWrapped : jsLhs} ${op} ${lang === "c" ? cRhsWrapped : jsRhs}) {\n${finalBody}\n}`;
  }

  // Dot product (produce) for vectors
  if (baseBe === "produce" && (ob?.ve || ob?.name || sentence.by || sentence.from)) {
    const leftSlot = (ob && Object.keys(ob).length) ? ob : sentence.from;
    const leftVec = vectorValuesExpr(leftSlot, { sentenceArg, locals, declared });
    const rightVec = vectorValuesExpr(sentence.by || sentence.from, { sentenceArg, locals, declared });
    const targetName = sentence.to?.name || "result";
    const targetBase = sanitizeName(targetName);
    const targetLval = lvalueForName(targetName, { declared, locals, field: "num" });

    const resultName = targetName === "result" ? targetName : "result";
    const resultBase = sanitizeName(resultName);
    const resultLval = lvalueForName(resultName, { declared, locals, field: "num" });

    const lines = [];
    lines.push(`const _a = ${leftVec};`);
    lines.push(`const _b = ${rightVec};`);
    lines.push(`if (_a.length !== _b.length) throw new Error("produce: vectors must be the same length");`);
    lines.push(`let _sum = 0;`);
    lines.push(`for (let i = 0; i < _a.length; i++) { const x = Number(_a[i]); const y = Number(_b[i]); if (Number.isNaN(x) || Number.isNaN(y)) throw new Error("produce: numeric values required"); _sum += x * y; }`);

    const ensureTargetObject = () => {
      if (!declared?.has(targetBase) && !locals?.has(targetBase)) {
        lines.push(`let ${targetBase} = { su: { name: "${targetName}" }, ob: {}, be: "number", mood: "ya" };`);
        declared?.add(targetBase);
      }
    };
    const ensureResultObject = () => {
      if (!declared?.has(resultBase) && !locals?.has(resultBase)) {
        lines.push(`let ${resultBase} = { su: { name: "${resultName}" }, ob: {}, be: "number", mood: "ya" };`);
        declared?.add(resultBase);
      }
    };

    ensureTargetObject();
    const targetAssign = targetLval.includes(".ob.") ? targetLval : `${targetBase}.ob.num`;
    lines.push(`${targetAssign} = _sum;`);

    ensureResultObject();
    const resultAssign = resultLval.includes(".ob.") ? resultLval : `${resultBase}.ob.num`;
    lines.push(`${resultAssign} = _sum;`);

    return lines.join("\n");
  }

  const durationUnit = ob && ["second", "minute", "hour", "day", "week"].find((unit) => ob[unit] !== undefined);
  if ((baseBe === "plus" || baseBe === "subtract") && durationUnit) {
    const direction = baseBe === "plus" ? 1 : -1;
    const amountValue = Number(ob[durationUnit]);
    if (Number.isNaN(amountValue)) return `// TODO: ${JSON.stringify(sentence)}`;
    const sourceSlot = baseBe === "plus" ? sentence.to : sentence.from;
    const targetSlot = sourceSlot;
    const dateExpr = (() => {
      if (!sourceSlot) return null;
      if (sourceSlot.date !== undefined) return JSON.stringify(sourceSlot.date);
      if (sourceSlot.name) {
        const baseName = sanitizeName(sourceSlot.name);
        if (lang === "c") return baseName;
        if (locals?.has(baseName) || declared?.has(baseName)) {
          return `${baseName}.ob?.date ?? ${baseName}.date ?? ${baseName}`;
        }
        return baseName;
      }
      if (sentenceArg) {
        const role = baseBe === "plus" ? "to" : "from";
        return targetPath(role, sentenceArg, "date", sourceSlot, { locals, declared });
      }
      return null;
    })();
    if (!dateExpr) return `// TODO: ${JSON.stringify(sentence)}`;
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesDateMath = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
      }
      const targetName = targetSlot?.name ?? "result";
      const targetVar = sanitizeName(targetName);
      const needsDecl = !locals?.has(targetVar) && !declared?.has(targetName);
      if (needsDecl) locals?.add(targetVar);
      const lines = [];
      lines.push(`char _date_buf[PYA_TEXT_CAP];`);
      lines.push(`if (!pya_date_add(${dateExpr}, "${durationUnit}", ${amountValue}, ${direction}, _date_buf, sizeof(_date_buf))) { fprintf(stderr, "date defective\\n"); exit(1); }`);
      if (needsDecl) {
        lines.push(`char ${targetVar}[PYA_TEXT_CAP];`);
      }
      lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", _date_buf);`);
      return lines.join("\n");
    }
    jsHelpers.usesDateMath = true;
    const dateCall = `pyaDateAdd(${dateExpr}, "${durationUnit}", ${amountValue}, ${direction})`;
    if (sentenceArg) {
      const role = baseBe === "plus" ? "to" : "from";
      const target = targetPath(role, sentenceArg, "date", targetSlot, { locals, declared }) ?? targetSlot?.name;
      return `${target} = ${dateCall};`;
    }
    if (targetSlot?.name) {
      const baseName = sanitizeName(targetSlot.name);
      const lines = [];
      if (!locals?.has(baseName) && !declared?.has(baseName)) {
        lines.push(`let ${baseName} = { su: { name: "${targetSlot.name}" }, ob: {}, be: "date", mood: "ya" };`);
        locals?.add(baseName);
      }
      lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
      lines.push(`${baseName}.ob.date = ${dateCall};`);
      return lines.join("\n");
    }
    return `globalThis["result"] = { su: { name: "result" }, ob: { date: ${dateCall} }, be: "date", mood: "ya" };`;
  }

  // Text concatenation via add (numeric source)
  if (baseBe === "plus" && (sentence.to?.name || sentence.to?.genitive)) {
    const objExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    const objTextExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "text" });
    const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
    const targetIsText =
      targetName &&
      (localsTypes?.get(targetName) === "text" || declaredTypes?.get(targetName) === "text");
    const canUseTextExpr =
      typeof ob.text === "string" ||
      (ob?.name && (localsTypes?.get(sanitizeName(ob.name)) === "text" || declaredTypes?.get(sanitizeName(ob.name)) === "text"));
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
        if (typeof ob.text === "string") {
          return `pya_concat_buf(${target}, ${JSON.stringify(ob.text)});`;
        }
        const textExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: "\"\"", field: "text" }) ?? "\"\"";
        return `pya_concat_buf(${target}, ${textExpr});`;
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
          lines.push(`snprintf(_key_buf, sizeof(_key_buf), "%g", ${rawKey});`);
          keyExpr = "_key_buf";
        } else if (keyTail === "boolean" || typeof sentence.su?.boolean !== "undefined") {
          lines.push("char _key_buf[8];");
          lines.push(`snprintf(_key_buf, sizeof(_key_buf), "%s", (${rawKey}) ? "truth" : "lie");`);
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
        lines.push("_base.ob = _base.ob ?? {};");
        lines.push(`_base.ob.num = (typeof _base.ob.num === "number" ? _base.ob.num : 0) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        lines.push(`${mapVar}.ob.map[_key] = _base;`);
      } else {
        lines.push(`${mapVar}.ob.map[_key] = { num: (typeof _curr?.num === "number" ? _curr.num : 0) + ${Number.isNaN(safeValue) ? 0 : safeValue} };`);
      }
      return lines.join("\n");
    }
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      // Compiler-only sugar: inside ceremonies, `to <localName>` targets the local fact object.
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
        ? `"${sentence.to.name}"`
        : genitiveHint
          ? `"${genitiveHint}"`
          : sentence.su?.name
            ? `"${sentence.su.name}"`
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
      const fieldPath = sentence.to?.genitive
        ? pathFromGenitive(sentence.to.genitive, targetVar, { locals, declared }) || `${targetVar}.ob.num`
        : `${targetVar}.ob.num`;
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
      return `${target} = ${target} + ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const lines = [];
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
      if (sentence.to?.genitive) {
        const target = pathFromGenitive(sentence.to.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
        if (target) return `pya_concat_buf(${target}, ${textExpr});`;
      }
      const target = sanitizeName(sentence.to.name);
      return `pya_concat_buf(${target}, ${textExpr});`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.text = (${sentence.to.name}.ob.text ?? "") + ${textExpr};`;
  }

  if (baseBe === "subtract" && ob.num !== undefined && ((sentence.to?.name || sentence.from?.name) || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      const targetSlot = sentence.to ?? sentence.from;
      const targetRole = sentence.to ? "to" : "from";
      const hasGenitive = Boolean(targetSlot?.genitive);
      if (!hasGenitive && targetSlot?.name) {
        const baseName = sanitizeName(targetSlot.name);
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "number");
        }
        if (lang === "c") {
          lines.push(`${baseName} = (${baseName} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        } else {
          lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
          lines.push(`${baseName}.ob.num = (${baseName}.ob.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        }
        return lines.join("\n");
      }
      const target = targetPath(targetRole, sentenceArg, "num", targetSlot, { locals, declared }) ?? targetSlot?.name;
      return `${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const targetSlot = sentence.to ?? sentence.from;
    const targetName = targetSlot?.name;
    if (!targetName) return `// TODO: ${JSON.stringify(sentence)}`;
    if (lang === "c") {
      return `${targetName} = ${targetName} - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${targetName}.ob = ${targetName}.ob ?? {};\n${targetName}.ob.num = (${targetName}.ob.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (
    baseBe === "multiply" &&
    sentence.by &&
    (sentence.ob || sentence.from) &&
    (sentence.to?.name || sentenceArg) &&
    (sentence.by?.name || sentence.by?.genitive || sentence.by?.thisRef || sentence.ob?.name || sentence.ob?.genitive || sentence.ob?.thisRef || sentence.from?.name || sentence.from?.genitive || sentence.from?.thisRef)
  ) {
    const lhsSlot = sentence.ob ?? sentence.from;
    const rhsSlot = sentence.by;
    const numericExpr = (slot) => {
      if (!slot) return "0";
      if (slot.num !== undefined) {
        const n = Number(slot.num);
        return Number.isNaN(n) ? "0" : String(n);
      }
      if (slot.name) {
        const base = sanitizeName(slot.name);
        if (lang === "c") {
          if (locals?.has(base) || declared?.has(base)) return base;
          return base;
        }
        if (localsTypes?.get(base) === "number" || declaredTypes?.get(base) === "number") {
          return `${base}.ob?.num ?? ${base}`;
        }
        if (locals?.has(base)) return base;
        if (declared?.has(base)) return `${base}.ob?.num ?? ${base}`;
        return base;
      }
      const direct = exprForSlot(slot, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (direct) return direct;
      return "0";
    };
    const lhsExpr = numericExpr(lhsSlot);
    const rhsExpr = numericExpr(rhsSlot);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        if (localsTypes) localsTypes.set(baseName, "number");
        lines.push(`${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
    }
    if (lang === "c") {
      const baseName = sanitizeName(sentence.to.name);
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) locals?.add(baseName);
      return needsDecl
        ? `double ${baseName} = (${lhsExpr}) * (${rhsExpr});`
        : `${baseName} = (${lhsExpr}) * (${rhsExpr});`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
  }

  if (baseBe === "multiply" && ob.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "divide" && ob.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    const divisor = Number.isNaN(safeValue) ? 1 : safeValue;
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) / ${divisor};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) / ${divisor};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} / ${divisor};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) / ${divisor};`;
  }

  if (baseBe === "remains" && (ob.num !== undefined || sentence.from?.num !== undefined || ob.name || ob.genitive || ob.thisRef) && (sentence.to?.name || sentenceArg)) {
    if (sentenceArg) {
      const targetGenitive = sentence.to?.genitive ? pathFromGenitive(sentence.to.genitive, sentenceArg, { locals, declared }) : null;
      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
      const source = (() => {
        if (sentence.ob?.genitive && sentenceArg) return pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared });
        if (ob?.name) {
          const baseName = sanitizeName(ob.name);
          if (locals?.has(baseName)) return `${baseName}.ob?.num`;
        }
        return exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      })();
      const divisorExpr = exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ??
        exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });

      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        lines.push(`let ${targetName};`);
        locals?.add(targetName);
      }

      const lhs = targetGenitive
        ? targetGenitive
        : targetName
          ? lvalueForName(targetName, { declared, locals })
          : targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? `${sentenceArg}.ob?.num`;
      const numerator = source ?? lhs;
      const div = divisorExpr ?? "0";
      lines.push(`if ((${div} ?? 0) === 0) throw new Error("remains: from cannot be zero");`);
      const expr = `(${numerator} ?? 0) % (${div} ?? 0)`;
      lines.push(`${lhs} = ${expr};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
      const hasExplicitDivisor = sentence.from != null || sentence.by != null;
      const divisor = hasExplicitDivisor
        ? (exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0")
        : (exprForSlot(sentence.ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0");
      // If the user wrote `ob num N to name X be remains do`, treat N as the divisor and X as the dividend.
      // Otherwise, treat `ob ... from ...` as dividend/divisor.
      const numerator = (!hasExplicitDivisor && sentence.ob?.num !== undefined)
        ? (targetName ?? "0")
        : (exprForSlot(sentence.ob, { sentenceArg, locals, declared, defaultExpr: targetName, field: "num" }) ?? targetName ?? "0");
      const lhs = targetName ?? "result";
      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        locals?.add(targetName);
        lines.push(`double ${targetName} = 0;`);
      }
      if (cHelpers) cHelpers.usesPrintf = cHelpers.usesPrintf;
      const cDivisor = cExpr(divisor);
      const cNumerator = cExpr(numerator);
      lines.push(`if ((${cDivisor}) == 0) { /* remains: from cannot be zero */ } else { ${lhs} = fmod(${cNumerator}, ${cDivisor}); }`);
      return lines.join("\n");
    }
    const divisorRaw = sentence.from?.num ?? ob.num;
    const divisor = typeof divisorRaw === "number" ? divisorRaw : Number(divisorRaw);
    const safeValue = Number.isNaN(divisor) ? 0 : divisor;
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) % ${safeValue};`;
  }

  return null;
}
