export function handleVectorElementRead({
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
  jsHelpers
} = {}, {
  sanitizeName,
  pathFromGenitive
} = {}) {
  if (baseBe !== "read" || !ob?.name) return null;
  const hasIndex = (ob.at?.num != null || ob.at?.genitive) || (sentence.at?.num != null || sentence.at?.genitive);
  if (!hasIndex || !(sentence.to?.name || sentenceArg)) return null;
  const baseName = sanitizeName(ob.name);
  const atSlot = ob.at ?? sentence.at;
  const idxExpr = (() => {
    if (atSlot?.num != null) {
      const idxVal = Number(atSlot.num);
      return Number.isNaN(idxVal) ? atSlot.num : idxVal;
    }
    if (atSlot?.genitive) {
      return pathFromGenitive(atSlot.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: lang === "c" });
    }
    return null;
  })();
  if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
  const targetName = sentence.to?.name ?? sentence.su?.name ?? "result";
  const targetVar = sanitizeName(targetName);
  const lines = [];
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesString = true;
      cHelpers.usesTextHelper = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
    }
    const vecType = declaredVectorTypes?.get(ob.name) ?? "num";
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar);
    if (vecType === "num") {
      lines.push(needsDecl ? `double ${targetVar} = 0;` : "");
      if (needsDecl) locals?.add(targetVar);
      if (localsTypes) localsTypes.set(targetVar, "number");
      lines.push(`${targetVar} = ${baseName}.num_values[(int)(${idxExpr})];`);
    } else if (vecType === "text") {
      lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = \"\";` : "");
      if (needsDecl) locals?.add(targetVar);
      if (localsTypes) localsTypes.set(targetVar, "text");
      lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, \"%s\", ${baseName}.text_values[(int)(${idxExpr})]);`);
    } else {
      lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = \"\";` : "");
      if (needsDecl) locals?.add(targetVar);
      if (localsTypes) localsTypes.set(targetVar, "text");
      lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, \"%s\", (${baseName}.num_values[(int)(${idxExpr})] != 0) ? \"truth\" : \"lie\");`);
    }
    return lines.filter(Boolean).join("\n");
  }
  if (!locals?.has(baseName) && !declared?.has(baseName)) {
    lines.push(`const ${baseName} = remember(${JSON.stringify(ob.name)});`);
    locals?.add(baseName);
  }
  const vecType = declaredVectorTypes?.get(ob.name) ?? "num";
  if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
    lines.push(`let ${targetVar} = { su: { name: \"${targetName}\" }, ob: {}, be: \"${vecType === "num" ? "number" : "text"}\", mood: \"ya\" };`);
    locals?.add(targetVar);
  }
  if (localsTypes) localsTypes.set(targetVar, vecType === "num" ? "number" : "text");
  const valVar = jsHelpers ? `_val_${jsHelpers.readCounter++}` : "_val";
  lines.push(`const ${valVar} = ${baseName}?.ob?.ve?.values?.[(${idxExpr})];`);
  if (vecType === "num") {
    lines.push(`${targetVar}.ob.num = ${valVar};`);
  } else {
    lines.push(`const _text = (${valVar} === true || ${valVar} === 1) ? \"truth\" : (${valVar} === false || ${valVar} === 0) ? \"lie\" : String(${valVar} ?? \"\");`);
    lines.push(`${targetVar}.ob.text = _text;`);
  }
  return lines.join("\n");
}
