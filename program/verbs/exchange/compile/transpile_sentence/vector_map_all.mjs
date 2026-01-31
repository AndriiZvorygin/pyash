export function handleVectorMapAll({
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
} = {}, {
  sanitizeName,
  pathFromGenitive,
  markDeclared,
  inlineSentenceLiteral,
  transpileSentence
} = {}) {
  if (sentence.at?.name !== "all") return null;
  if (lang === "c") {
    const fn = ceremonyFns?.get(baseBe);
    const isPrimitive = baseBe === "plus" || baseBe === "subtract" || baseBe === "invert";
    const vecName = sentence.ob?.name;
    if (!vecName || (!fn && !isPrimitive)) {
      return `/* TODO: ${JSON.stringify(sentence)} */`;
    }
    const vecVar = sanitizeName(vecName);
    const vecType = declaredVectorTypes?.get(vecName) ?? "num";
    const targetName = sentence.to?.name ?? vecName;
    const targetVar = sanitizeName(targetName);
    const needsDecl = sentence.to?.name && !locals?.has(targetVar) && !declared?.has(targetName);
    const retType = fn ? (ceremonyReturnTypes?.get(baseBe) ?? "number") : null;
    const outType = fn
      ? (retType === "text" ? "text" : "num")
      : (baseBe === "invert" && (vecType === "bool" || vecType === "boolean") ? "bool" : "num");
    if (cHelpers) {
      cHelpers.usesVectorType = true;
      cHelpers.usesStdlib = true;
      if (fn) cHelpers.usesMapGlobals = true;
      if (fn) cHelpers.usesCeremonyValue = true;
    }
    if (sentence.to?.name) {
      markDeclared(declared, targetName);
      declaredVectorTypes?.set(targetName, outType);
    } else if (declaredVectorTypes && vecName) {
      declaredVectorTypes.set(vecName, outType);
    }
    if (vecType === "text" && isPrimitive) {
      return `/* TODO: ${JSON.stringify(sentence)} */`;
    }
    const outSuffix = cState ? cState.vectorCounter++ : 0;
    const outNumVar = `_pya_out_num_${outSuffix}`;
    const outTextVar = `_pya_out_text_${outSuffix}`;
    const outVecVar = `_pya_out_vec_${outSuffix}`;
    const outAssignVar = sentence.to?.name ? targetVar : vecVar;
    const lines = [];
    if (needsDecl) lines.push(`pya_vec ${targetVar};`);
    lines.push(`int _pya_len_${outSuffix} = ${vecVar}.length;`);
    if (outType === "text") {
      lines.push(`const char **${outTextVar} = (const char **)malloc(sizeof(char *) * _pya_len_${outSuffix});`);
    } else {
      lines.push(`double *${outNumVar} = (double *)malloc(sizeof(double) * _pya_len_${outSuffix});`);
    }
    if (fn) {
      const fromExpr = (() => {
        if (sentence.from?.num !== undefined) return String(Number(sentence.from.num) || 0);
        if (sentence.from?.name) return sanitizeName(sentence.from.name);
        if (sentence.from?.genitive) {
          return pathFromGenitive(sentence.from.genitive, undefined, { locals, declared, localsTypes: null, declaredTypes: null, allowCGlobals: true }) ?? "0";
        }
        return null;
      })();
      const byExpr = (() => {
        if (sentence.by?.num !== undefined) return String(Number(sentence.by.num) || 0);
        if (sentence.by?.name) return sanitizeName(sentence.by.name);
        if (sentence.by?.genitive) {
          return pathFromGenitive(sentence.by.genitive, undefined, { locals, declared, localsTypes: null, declaredTypes: null, allowCGlobals: true }) ?? "0";
        }
        return null;
      })();
      lines.push("{");
      lines.push("double _saved_ob = pya_ob_num;");
      lines.push("double _saved_from = pya_from_num;");
      lines.push("double _saved_by = by;");
      lines.push("double _saved_atindex = atindex;");
      lines.push("const char *_saved_ob_text = pya_ob_text;");
      lines.push("int _saved_ob_bool = pya_ob_bool;");
      lines.push("pya_ob_num = 0;");
      lines.push("pya_ob_text = 0;");
      lines.push("pya_ob_bool = 0;");
      lines.push("pya_from_num = 0;");
      lines.push("by = 0;");
      if (fromExpr) lines.push(`pya_from_num = ${fromExpr};`);
      if (byExpr) lines.push(`by = ${byExpr};`);
      lines.push(`for (int i = 0; i < _pya_len_${outSuffix}; i++) {`);
      lines.push("  atindex = i;");
      if (vecType === "text") {
        lines.push(`  pya_ob_text = ${vecVar}.text_values[i];`);
        lines.push("  pya_ob_num = 0;");
        lines.push("  pya_ob_bool = 0;");
      } else if (vecType === "bool" || vecType === "boolean") {
        lines.push(`  pya_ob_bool = ${vecVar}.num_values[i] != 0;`);
        lines.push(`  pya_ob_num = ${vecVar}.num_values[i];`);
        lines.push("  pya_ob_text = 0;");
      } else {
        lines.push(`  pya_ob_num = ${vecVar}.num_values[i];`);
        lines.push("  pya_ob_text = 0;");
        lines.push("  pya_ob_bool = 0;");
      }
      const retVar = `_pya_ret_${outSuffix}`;
      lines.push(`  pya_value ${retVar} = ${fn}();`);
      if (outType === "text") {
        lines.push(`  ${outTextVar}[i] = ${retVar}.text ? ${retVar}.text : \"\";`);
      } else {
        lines.push(`  ${outNumVar}[i] = ${retVar}.num;`);
      }
      lines.push("}");
      lines.push("pya_ob_num = _saved_ob;");
      lines.push("pya_from_num = _saved_from;");
      lines.push("by = _saved_by;");
      lines.push("atindex = _saved_atindex;");
      lines.push("pya_ob_text = _saved_ob_text;");
      lines.push("pya_ob_bool = _saved_ob_bool;");
      lines.push("}");
    } else {
      const deltaVal = Number(sentence.from?.num ?? sentence.ob?.num ?? 0);
      const delta = Number.isNaN(deltaVal) ? 0 : deltaVal;
      lines.push(`for (int i = 0; i < _pya_len_${outSuffix}; i++) {`);
      if (baseBe === "invert") {
        if (vecType === "bool" || vecType === "boolean") {
          lines.push(`  ${outNumVar}[i] = ${vecVar}.num_values[i] != 0 ? 0 : 1;`);
        } else {
          lines.push(`  ${outNumVar}[i] = -${vecVar}.num_values[i];`);
        }
      } else if (baseBe === "plus") {
        lines.push(`  ${outNumVar}[i] = ${vecVar}.num_values[i] + ${delta};`);
      } else {
        lines.push(`  ${outNumVar}[i] = ${vecVar}.num_values[i] - ${delta};`);
      }
      lines.push("}");
    }
    if (outType === "text") {
      lines.push(`pya_vec ${outVecVar} = { \"text\", _pya_len_${outSuffix}, NULL, ${outTextVar} };`);
    } else if (outType === "bool") {
      lines.push(`pya_vec ${outVecVar} = { \"bool\", _pya_len_${outSuffix}, ${outNumVar}, NULL };`);
    } else {
      lines.push(`pya_vec ${outVecVar} = { \"num\", _pya_len_${outSuffix}, ${outNumVar}, NULL };`);
    }
    lines.push(`${outAssignVar} = ${outVecVar};`);
    return lines.join("\n");
  }
  if (lang !== "c") {
    if (ceremonyFns?.get(baseBe)) {
      const fn = ceremonyFns.get(baseBe);
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const literal = inlineSentenceLiteral(sentence, inlineSet);
      if (sentenceArg && sentence.by?.genitive?.chain?.[0] === "this") {
        const byExpr = pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared }) ?? "0";
        return `{
  const _ev = ${literal};
  _ev.by = { num: (${byExpr} ?? 0) };
  runAtAll(_ev, ${fn});
}`;
      }
      return `runAtAll(${literal}, ${fn});`;
    }
    if (baseBe === "plus" || baseBe === "subtract" || baseBe === "invert") {
      if (sentenceArg) return `// TODO: ${JSON.stringify(sentence)}`;
      const vecName = sentence.ob?.name;
      const toName = sentence.to?.name;
      const delta = Number(sentence.from?.num ?? sentence.ob?.num ?? 0);
      const opBody =
        baseBe === "invert"
          ? `let val = elem;\n    if (typeof val === \"number\") return val * -1;\n    if (val === \"truth\" || val === true) return \"lie\";\n    if (val === \"lie\" || val === false) return \"truth\";\n    return val;`
          : baseBe === "plus"
            ? `return (Number(elem) || 0) + ${Number.isNaN(delta) ? 0 : delta};`
            : `return (Number(elem) || 0) - ${Number.isNaN(delta) ? 0 : delta};`;
      const lines = [];
      lines.push(`{`);
      lines.push(`let vecFact = remember(${JSON.stringify(vecName ?? sentence.ob ?? "vec")}) || (typeof ${sanitizeName(vecName ?? "vec")} !== \"undefined\" ? ${sanitizeName(vecName ?? "vec")} : undefined);`);
      lines.push(`const values = vecFact?.ob?.ve?.values ?? vecFact?.ve?.values ?? [];`);
      lines.push(`const outVals = values.map((elem, i) => {`);
      lines.push(opBody.split("\n").map(l => `  ${l}`).join("\n"));
      lines.push(`});`);
      if (toName) {
        lines.push(`const fact = { su: { name: ${JSON.stringify(toName)} }, ob: { ve: { values: outVals } }, be: \"vector\", mood: \"ya\" };`);
        lines.push(`globalThis[${JSON.stringify(toName)}] = fact;`);
        lines.push(`if (typeof ${sanitizeName(toName)} !== \"undefined\") { ${sanitizeName(toName)} = fact; }`);
        lines.push(`/* end map */`);
      } else if (vecName) {
        lines.push(`if (vecFact?.ob?.ve) { vecFact.ob.ve.values = outVals; }`);
        lines.push(`const fallback = { su: { name: ${JSON.stringify(vecName)} }, ob: { ve: { values: outVals } }, be: \"vector\", mood: \"ya\" };`);
        lines.push(`const finalFact = vecFact || fallback;`);
        lines.push(`globalThis[${JSON.stringify(vecName)}] = finalFact;`);
        lines.push(`if (typeof ${sanitizeName(vecName)} !== \"undefined\") { ${sanitizeName(vecName)} = finalFact; }`);
        lines.push(`/* end map */`);
      } else {
        lines.push(`const fact = { ob: { ve: { values: outVals } }, be: \"vector\", mood: \"ya\" };`);
        lines.push(`/* end map */`);
      }
      lines.push(`}`);
      if (rememberFlag) rememberFlag.used = true;
      return lines.join("\n");
    }
  }
  return null;
}
