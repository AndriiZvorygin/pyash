export function handleDateLiteral({
  sentence,
  ob,
  lang,
  sentenceArg,
  name,
  effectiveBe,
  shouldDeclare,
  locals,
  localsTypes,
  declared,
  cHelpers
} = {}, {
  sanitizeName,
  valueForRole
} = {}) {
  if (ob?.date === undefined) return null;
  const value = JSON.stringify(ob.date);
  if (sentenceArg) {
    const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
    if (baseName) {
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) {
        locals?.add(baseName);
        if (localsTypes) localsTypes.set(baseName, "date");
        return `let ${baseName} = { su: { name: \"${sentence.su.name}\" }, ob: {}, be: \"date\", mood: \"ya\" };\n${baseName}.ob.date = ${value};`;
      }
      if (localsTypes) localsTypes.set(baseName, "date");
      return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.date = ${value};`;
    }
    const target = valueForRole("su", sentenceArg, "date", sentence.su) ?? name;
    return `${target} = ${value};`;
  }
  const sentenceObject = `{ su: { name: \"${name}\" }, ob: { date: ${value} }, be: \"${effectiveBe}\", exists: ${shouldDeclare}, mood: \"ya\" }`;
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesPrintf = true;
    }
    const cName = sanitizeName(name);
    if (shouldDeclare) {
      locals?.add(cName);
      if (localsTypes) localsTypes.set(cName, "date");
    }
    if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, \"%s\", ${value});`;
    return `char ${cName}[PYA_TEXT_CAP] = ${value};`;
  }
  const varName = sanitizeName(name);
  if (shouldDeclare) {
    return `let ${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
  }
  return `${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
}

export function handleNumberLiteral({
  sentence,
  ob,
  lang,
  sentenceArg,
  name,
  effectiveBe,
  shouldDeclare,
  locals,
  localsTypes,
  declared,
  declaredTypes,
  isPermanent
} = {}, {
  sanitizeName,
  valueForRole,
  exprForSlot
} = {}) {
  if (effectiveBe !== "number") return null;
  const rhsExpr = exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
  if (sentenceArg && rhsExpr !== null) {
    const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
    if (baseName) {
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) {
        locals?.add(baseName);
        if (localsTypes) localsTypes.set(baseName, "number");
        if (ob?.thisRef === "ob") {
          return `let ${baseName} = { su: { name: \"${sentence.su.name}\" }, ob: {}, be: \"number\", mood: \"ya\" };\n${baseName}.ob = ${sentenceArg}.ob;`;
        }
        return `let ${baseName} = { su: { name: \"${sentence.su.name}\" }, ob: {}, be: \"number\", mood: \"ya\" };\n${baseName}.ob.num = ${rhsExpr};`;
      }
      if (localsTypes) localsTypes.set(baseName, "number");
      if (ob?.thisRef === "ob") {
        return `${baseName}.ob = ${sentenceArg}.ob;`;
      }
      return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.num = ${rhsExpr};`;
    }
    const target = valueForRole("su", sentenceArg, "num", sentence.su) ?? `${sentenceArg}.ob?.num`;
    return `${target} = ${rhsExpr};`;
  }

  if (lang === "c" && !sentenceArg && sentence.su?.name) {
    const baseName = sanitizeName(sentence.su.name);
    const fromRef = ob?.thisRef ? ob.thisRef : null;
    const rhs = rhsExpr ?? fromRef ?? (typeof ob.num !== "undefined" ? ob.num : null);
    if (rhs !== null) {
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) locals?.add(baseName);
      return needsDecl ? `double ${baseName} = ${rhs};` : `${baseName} = ${rhs};`;
    }
  }

  if (typeof ob.num !== "undefined") {
    const value = typeof ob.num === "number" ? ob.num : Number(ob.num);
    const safeValue = Number.isNaN(value) ? 0 : value;
    const sentenceObject = `{ su: { name: \"${name}\" }, ob: { num: ${safeValue} }, be: \"${effectiveBe}\", exists: ${shouldDeclare}, mood: \"ya\" }`;
    const decl = shouldDeclare ? (lang === "c" ? "/* TODO: sentence object in C */" : (isPermanent ? "const" : "let")) : "";
    if (lang === "c") {
      const cName = sanitizeName(name);
      if (shouldDeclare) {
        locals?.add(cName);
        if (localsTypes) localsTypes.set(cName, "number");
      }
      if (!shouldDeclare) return `${cName} = ${safeValue};`;
      const cdecl = isPermanent ? "const double" : "double";
      return `${cdecl} ${cName} = ${safeValue};`;
    }
    const varName = sanitizeName(name);
    if (shouldDeclare) {
      return `${decl} ${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
    }
    return `${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
  }
  return null;
}

export function handleTextLiteral({
  sentence,
  ob,
  lang,
  sentenceArg,
  name,
  effectiveBe,
  shouldDeclare,
  locals,
  localsTypes,
  declared,
  cHelpers
} = {}, {
  sanitizeName,
  valueForRole
} = {}) {
  if (effectiveBe !== "text" || typeof ob.text !== "string") return null;
  const value = JSON.stringify(ob.text);
  if (sentenceArg) {
    const baseName = sentence.su?.name ? sanitizeName(sentence.su.name) : null;
    if (baseName) {
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) {
        locals?.add(baseName);
        if (localsTypes) localsTypes.set(baseName, "text");
        return `let ${baseName} = { su: { name: \"${sentence.su.name}\" }, ob: {}, be: \"text\", mood: \"ya\" };\n${baseName}.ob.text = ${value};`;
      }
      if (localsTypes) localsTypes.set(baseName, "text");
      return `${baseName}.ob = ${baseName}.ob ?? {};\n${baseName}.ob.text = ${value};`;
    }
    const target = valueForRole("su", sentenceArg, "text") ?? name;
    return `${target} = ${value};`;
  }
  const sentenceObject = `{ su: { name: \"${name}\" }, ob: { text: ${value} }, be: \"${effectiveBe}\", exists: ${shouldDeclare}, mood: \"ya\" }`;
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesPrintf = true;
    }
    const cName = sanitizeName(name);
    if (shouldDeclare) {
      locals?.add(cName);
      if (localsTypes) localsTypes.set(cName, "text");
    }
    if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, \"%s\", ${value});`;
    return `char ${cName}[PYA_TEXT_CAP] = ${value};`;
  }
  const varName = sanitizeName(name);
  if (shouldDeclare) {
    return `let ${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
  }
  return `${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
}

export function handleSentenceLiteral({
  sentence,
  ob,
  lang,
  name,
  effectiveBe,
  shouldDeclare,
  locals,
  localsTypes,
  cHelpers,
  declared
} = {}, {
  sanitizeName,
  inlineSentenceLiteral,
  sentenceToPyash
} = {}) {
  if (!ob?.la || !name) return null;
  const laLiteral = inlineSentenceLiteral(ob.la, declared);
  const sentenceObject = `{ su: { name: \"${name}\" }, ob: { la: ${laLiteral} }, be: \"${effectiveBe}\", exists: ${shouldDeclare}, mood: \"ya\" }`;
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
    }
    const cName = sanitizeName(name);
    const pyash = sentenceToPyash(sentence);
    const literal = JSON.stringify(pyash);
    if (!shouldDeclare) return `snprintf(${cName}, PYA_TEXT_CAP, \"%s\", ${literal});`;
    return `char ${cName}[PYA_TEXT_CAP] = ${literal};`;
  }
  const varName = sanitizeName(name);
  if (shouldDeclare) {
    return `let ${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
  }
  return `${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
}
