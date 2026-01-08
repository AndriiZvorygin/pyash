export function handleVectorElementOps(context, helpers) {
  const {
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
  } = context;
  const {
    sanitizeName,
    exprForSlot,
    indexExprFromAt,
    pathFromGenitive
  } = helpers;

  const atSlot = sentence.at ?? ob.at;
  const atNum = atSlot?.num;
  const atGenitive = atSlot?.genitive;

  // Vector element write (JS)
  if (baseBe === "write" && (sentence.to?.name || ob?.name) && (atNum != null || atGenitive) && lang !== "c") {
    const vecNameRaw = sentence.to?.name ?? ob?.name;
    const baseName = sanitizeName(vecNameRaw);
    const idxExpr = indexExprFromAt(atSlot, {
      sentenceArg,
      locals,
      declared,
      localsTypes,
      declaredTypes,
      pathFromGenitive
    });
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;

    let valueExpr = "undefined";
    if (ob?.num !== undefined) {
      const numVal = Number(ob.num);
      valueExpr = Number.isNaN(numVal) ? ob.num : numVal;
    } else if (ob?.text !== undefined) {
      valueExpr = JSON.stringify(ob.text);
    } else if (ob?.boolean !== undefined) {
      valueExpr = ob.boolean ? "\"truth\"" : "\"lie\"";
    } else if (ob?.genitive) {
      const genExpr = pathFromGenitive(ob.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes });
      if (genExpr) valueExpr = genExpr;
    } else if (ob?.name) {
      const nameExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (nameExpr) valueExpr = nameExpr;
    }

    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(vecNameRaw)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
    lines.push(`${baseName}.ob.ve = ${baseName}.ob.ve ?? {};`);
    lines.push(`${baseName}.ob.ve.values = ${baseName}.ob.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr});`);
    lines.push(`${baseName}.ob.ve.values[_idx] = ${valueExpr};`);
    return lines.join("\n");
  }

  // Vector element update in C: write/add/subtract/invert at index
  if (lang === "c") {
    const vecNameRaw = sentence.to?.name ?? ob?.name;
    if (baseBe === "write" && vecNameRaw && (atNum != null || atGenitive)) {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesString = true;
      }
      const vecName = sanitizeName(vecNameRaw);
      const idxExpr = indexExprFromAt(atSlot, {
        sentenceArg,
        locals,
        declared,
        localsTypes,
        declaredTypes,
        allowCGlobals: true,
        pathFromGenitive
      });
      if (idxExpr == null) return `/* TODO: ${JSON.stringify(sentence)} */`;
      const numExpr =
        ob?.genitive
          ? (pathFromGenitive(ob.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: true }) ?? "0")
          : (ob?.num !== undefined ? String(Number(ob.num) || 0) : (ob?.boolean ? "1" : "0"));
      const boolExpr =
        ob?.boolean !== undefined
          ? (ob.boolean ? "1" : "0")
          : ob?.text === "truth"
            ? "1"
            : ob?.text === "lie"
              ? "0"
              : numExpr;
      const textVal = ob?.text !== undefined ? JSON.stringify(ob.text) : "\"\"";
      const lines = [];
      lines.push(`int _idx = (int)(${idxExpr});`);
      lines.push(`if (_idx >= 0 && _idx < ${vecName}.length) {`);
      lines.push(`  if (!${vecName}.type || strcmp(${vecName}.type, "num") == 0) {`);
      lines.push(`    ${vecName}.num_values[_idx] = ${numExpr};`);
      lines.push(`  } else if (strcmp(${vecName}.type, "bool") == 0) {`);
      lines.push(`    ${vecName}.num_values[_idx] = ${boolExpr};`);
      lines.push(`  } else if (strcmp(${vecName}.type, "text") == 0) {`);
      lines.push(`    ${vecName}.text_values[_idx] = ${textVal};`);
      lines.push("  }");
      lines.push("}");
      return lines.join("\n");
    }
    if ((baseBe === "add" || baseBe === "subtract" || baseBe === "invert") && vecNameRaw && (atNum != null || atGenitive)) {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesString = true;
      }
      const vecName = sanitizeName(vecNameRaw);
      const idxExpr = indexExprFromAt(atSlot, {
        sentenceArg,
        locals,
        declared,
        localsTypes,
        declaredTypes,
        allowCGlobals: true,
        pathFromGenitive
      });
      if (idxExpr == null) return `/* TODO: ${JSON.stringify(sentence)} */`;
      const deltaVal = Number(ob?.num ?? sentence.from?.num ?? 0);
      const delta = Number.isNaN(deltaVal) ? 0 : deltaVal;
      const lines = [];
      lines.push(`int _idx = (int)(${idxExpr});`);
      lines.push(`if (_idx >= 0 && _idx < ${vecName}.length) {`);
      lines.push(`  if (!${vecName}.type || strcmp(${vecName}.type, "num") == 0) {`);
      if (baseBe === "invert") {
        lines.push(`    ${vecName}.num_values[_idx] = -${vecName}.num_values[_idx];`);
      } else if (baseBe === "add") {
        lines.push(`    ${vecName}.num_values[_idx] += ${delta};`);
      } else {
        lines.push(`    ${vecName}.num_values[_idx] -= ${delta};`);
      }
      lines.push(`  } else if (strcmp(${vecName}.type, "bool") == 0) {`);
      if (baseBe === "invert") {
        lines.push(`    ${vecName}.num_values[_idx] = ${vecName}.num_values[_idx] != 0 ? 0 : 1;`);
      }
      lines.push("  }");
      lines.push("}");
      return lines.join("\n");
    }
  }

  // Vector element invert (toggle boolean or numeric 0/1): invert ob name doors at num 2 do
  if (baseBe === "invert" && ob?.name && (atNum != null || atGenitive) && lang !== "c") {
    const baseName = sanitizeName(ob.name);
    const idxExpr = indexExprFromAt(atSlot, {
      sentenceArg,
      locals,
      declared,
      localsTypes,
      declaredTypes,
      pathFromGenitive
    });
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(ob.name)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
    lines.push(`${baseName}.ob.ve = ${baseName}.ob.ve ?? {};`);
    lines.push(`${baseName}.ob.ve.values = ${baseName}.ob.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr});`);
    lines.push(`const _curr = ${baseName}.ob.ve.values[_idx];`);
    lines.push(`if (${baseName}.ob.ve.type === "num" || typeof _curr === "number") {`);
    lines.push(`  ${baseName}.ob.ve.values[_idx] = (Number(_curr) || 0) * -1;`);
    lines.push("} else {");
    lines.push(`  ${baseName}.ob.ve.values[_idx] = (_curr === "truth" || _curr === true || _curr === 1) ? "lie" : "truth";`);
    lines.push("}");
    return lines.join("\n");
  }

  return null;
}
