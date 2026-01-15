export function handleDoSentence(context, helpers) {
  const {
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
    locals
  } = context;
  const {
    inlineSentenceLiteral,
    sanitizeName,
    pathFromGenitive,
    markDeclared
  } = helpers;

  const mood = sentence?.mood;
  if (mood !== "do") return null;

  if (sentenceArg) {
    const fn = ceremonyFns?.get(baseBe);
    if (fn && (sentence.fromindex !== undefined || sentence.toindex !== undefined)) {
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const evokerLiteral = inlineSentenceLiteral(sentence, inlineSet);
      if (loopShim) loopShim.used = true;
      const genFromExpr = sentence.fromindex?.genitive
        ? pathFromGenitive(sentence.fromindex.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      const genToExpr = sentence.toindex?.genitive
        ? pathFromGenitive(sentence.toindex.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      if (genFromExpr || genToExpr) {
        const lines = ["{"];
        lines.push(`const _call = ${evokerLiteral};`);
        if (genFromExpr) lines.push(`_call.fromindex = { num: ${genFromExpr} };`);
        if (genToExpr) lines.push(`_call.toindex = { num: ${genToExpr} };`);
        lines.push(`runLoop(_call, ${fn});`);
        lines.push("}");
        return lines.join("\n");
      }
      return `runLoop(${evokerLiteral}, ${fn});`;
    }
    if (fn) {
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const arg = inlineSentenceLiteral(sentence, inlineSet);
      const genObjExpr = sentence.ob?.genitive
        ? pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      const genByExpr = sentence.by?.genitive
        ? pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      if (sentence.to?.name) {
        const targetVar = sanitizeName(sentence.to.name);
        const lines = [];
        if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
          lines.push(`let ${targetVar};`);
          locals?.add(targetVar);
        }
        if (genObjExpr || genByExpr) {
          lines.push("{");
          lines.push(`const _call = ${arg};`);
          if (genObjExpr) {
            lines.push(`_call.ob = { num: ${genObjExpr} };`);
          }
          if (genByExpr) {
            lines.push(`_call.by = { num: ${genByExpr} };`);
          }
          lines.push(`${targetVar} = ${fn}(_call);`);
          lines.push("}");
        } else {
          lines.push(`${targetVar} = ${fn}(${arg});`);
        }
        return lines.join("\n");
      }
      if (genObjExpr || genByExpr) {
        const lines = ["{", `  const _call = ${arg};`];
        if (genObjExpr) lines.push(`  _call.ob = { num: ${genObjExpr} };`);
        if (genByExpr) lines.push(`  _call.by = { num: ${genByExpr} };`);
        lines.push(`  ${fn}(_call);`, "}");
        return lines.join("\n");
      }
      return `${fn}(${arg});`;
    }
    return null;
  }

  const fn = ceremonyFns?.get(baseBe);
  if (fn && (sentence.fromindex !== undefined || sentence.toindex !== undefined)) {
    if (lang === "c") {
      const loopId = cState ? cState.vectorCounter++ : 0;
      const byExpr = (() => {
        if (sentence.by?.num !== undefined) return Number(sentence.by.num) || 0;
        if (sentence.by?.name) return sanitizeName(sentence.by.name);
        if (sentence.by?.genitive) return pathFromGenitive(sentence.by.genitive, undefined, { allowCGlobals: true }) ?? "0";
        return null;
      })();
      const fromGenChain = sentence.fromindex?.genitive?.chain;
      const fromGenFallback = (Array.isArray(fromGenChain) && typeof fromGenChain[0] === "string")
        ? sanitizeName(fromGenChain[0])
        : null;
      const start = sentence.fromindex?.genitive
        ? (pathFromGenitive(sentence.fromindex.genitive, undefined, { allowCGlobals: true }) ?? fromGenFallback ?? 0)
        : (sentence.fromindex?.num ?? sentence.fromindex ?? 0);
      const hasUntil = sentence.toindex !== undefined;
      const toGenChain = sentence.toindex?.genitive?.chain;
      const toGenFallback = (Array.isArray(toGenChain) && typeof toGenChain[0] === "string")
        ? sanitizeName(toGenChain[0])
        : null;
      const untilVal = sentence.toindex?.genitive
        ? (pathFromGenitive(sentence.toindex.genitive, undefined, { allowCGlobals: true }) ?? toGenFallback ?? 0)
        : (sentence.toindex?.num ?? sentence.toindex ?? 0);
      if (hasUntil) {
        const step = untilVal > start ? 1 : -1;
        const byAssign = byExpr !== null ? `by = ${byExpr}; ` : "";
        return `{ double _saved_fromindex_${loopId} = fromindex; double _saved_toindex_${loopId} = toindex; for (fromindex = ${start}; fromindex != ${untilVal}; fromindex += ${step}) { toindex = ${untilVal}; ${byAssign}${fn}(); } fromindex = _saved_fromindex_${loopId}; toindex = _saved_toindex_${loopId}; }`;
      }
      const byAssign = byExpr !== null ? `by = ${byExpr}; ` : "";
      return `{ double _saved_fromindex_${loopId} = fromindex; for (fromindex = ${start}; fromindex > 0; fromindex--) { ${byAssign}${fn}(); } fromindex = _saved_fromindex_${loopId}; }`;
    }
    const evokerLiteral = inlineSentenceLiteral(sentence, declared);
    if (loopShim) loopShim.used = true;
    return `runLoop(${evokerLiteral}, ${fn});`;
  }
  if (fn) {
    if (lang === "c") {
      const retType = ceremonyReturnTypes?.get(baseBe) ?? null;
      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
      const toIsText = targetName && (declaredTypes?.get(targetName) === "text" || retType === "text");
      if (cHelpers) {
        cHelpers.usesMapGlobals = true;
        cHelpers.usesCeremonyValue = true;
        if (toIsText) {
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesPrintf = true;
        }
      }
      const obNum = sentence.ob?.num;
      const obText = typeof sentence.ob?.text === "string" ? sentence.ob.text : null;
      const obName = sentence.ob?.name ? sanitizeName(sentence.ob.name) : null;
      const obNameType = obName ? declaredTypes?.get(obName) : null;
      const fromVal = sentence.from?.num;
      const fromName = sentence.from?.name ? sanitizeName(sentence.from.name) : null;
      const fromNameType = fromName ? declaredTypes?.get(fromName) : null;
      const byVal = sentence.by?.num;
      const byName = sentence.by?.name ? sanitizeName(sentence.by.name) : null;
      const byNameType = byName ? declaredTypes?.get(byName) : null;
      const lines = ["{", "double _saved_ob = pya_ob_num;", "double _saved_from = pya_from_num;", "double _saved_by = by;", "const char *_saved_ob_text = pya_ob_text;"];
      lines.push("pya_ob_num = 0;");
      lines.push("pya_ob_text = 0;");
      lines.push("pya_from_num = 0;");
      lines.push("by = 0;");
      if (obNum !== undefined) lines.push(`pya_ob_num = ${Number(obNum) || 0};`);
      if (obText !== null) lines.push(`pya_ob_text = ${JSON.stringify(obText)};`);
      if (obName && obNameType === "text") lines.push(`pya_ob_text = ${obName};`);
      if (obName && obNameType === "number") lines.push(`pya_ob_num = ${obName};`);
      if (fromVal !== undefined) lines.push(`pya_from_num = ${Number(fromVal) || 0};`);
      if (fromName && fromNameType === "number") lines.push(`pya_from_num = ${fromName};`);
      if (byVal !== undefined) lines.push(`by = ${Number(byVal) || 0};`);
      if (byName && byNameType === "number") lines.push(`by = ${byName};`);
      const retVar = `_pya_ret_${cState ? (cState.ceremonyCounter++ || 0) : 0}`;
      lines.push(`pya_value ${retVar} = ${fn}();`);
      if (targetName) {
        const needsDecl = !declared?.has(targetName) && !locals?.has(targetName);
        if (toIsText) {
          if (needsDecl) {
            lines.unshift(`char ${targetName}[PYA_TEXT_CAP] = "";`);
            markDeclared(declared, targetName);
            declaredTypes?.set(targetName, "text");
          }
          lines.push(`snprintf(${targetName}, PYA_TEXT_CAP, "%s", ${retVar}.text ? ${retVar}.text : "");`);
        } else {
          if (needsDecl) {
            lines.unshift(`double ${targetName} = 0;`);
            markDeclared(declared, targetName);
            declaredTypes?.set(targetName, "number");
          }
          lines.push(`${targetName} = ${retVar}.num;`);
        }
      }
      lines.push("pya_ob_num = _saved_ob;", "pya_from_num = _saved_from;", "by = _saved_by;", "pya_ob_text = _saved_ob_text;", "}");
      return lines.join("\n");
    }
    const arg = inlineSentenceLiteral(sentence, declared);
    if (sentence.to?.name) {
      const targetVar = sanitizeName(sentence.to.name);
      const lines = [];
      if (!declared?.has(targetVar)) {
        lines.push(`let ${targetVar};`);
        markDeclared(declared, sentence.to.name);
      }
      lines.push(`${targetVar} = ${fn}(${arg});`);
      lines.push(`globalThis["${sentence.to.name}"] = ${targetVar};`);
      return lines.join("\n");
    }
    return `${fn}(${arg});`;
  }

  return null;
}
