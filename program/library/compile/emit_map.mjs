export function handleMapEnumeration(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    lang,
    locals,
    declared,
    declaredTypes,
    declaredVectorTypes,
    cHelpers,
    cState,
    mapDefs
  } = context;
  const {
    throwErrorSentence,
    jsonFromMapSentence,
    compareUtf8,
    sanitizeName
  } = helpers;

  if (baseBe !== "read" || ob?.genitive?.chain?.at(-1) !== "all") return null;

  const chain = ob.genitive.chain;
  const mapName = chain[0];
  const role = chain.length > 2 ? chain[chain.length - 2] : null;
  const mapSentence = mapDefs?.get(mapName);
  if (!mapSentence || mapSentence.be !== "json map") {
    throwErrorSentence({
      name: "json map enumeration defective",
      message: "json map enumeration defective",
      from: { name: "compile" },
      raw: { name: mapName }
    });
  }
  const jsonObj = jsonFromMapSentence(mapSentence, mapDefs, new Set());
  const keys = Object.keys(jsonObj).sort(compareUtf8);
  const values = keys.map((key) => jsonObj[key]);
  const targetName = sentence.to?.name ?? "result";
  const targetVar = sanitizeName(targetName);
  const needsDecl = !locals?.has(targetVar) && !declared?.has(targetName);
  const markDeclared = (vecType) => {
    if (targetName) {
      declared?.add(targetName);
      declaredTypes?.set(targetName, "vector");
      if (vecType) declaredVectorTypes?.set(targetName, vecType);
    }
  };
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesVectorType = true;
      cHelpers.usesVectorPrinter = true;
      cHelpers.usesString = true;
      cHelpers.usesCtype = true;
    }
    const suffix = cState ? cState.vectorCounter++ : 0;
    const vecName = targetVar;
    if (role === "su") {
      const literal = keys.map((key) => JSON.stringify(String(key))).join(", ");
      markDeclared("text");
      if (needsDecl) {
        return `const char *${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "text", ${keys.length}, NULL, ${vecName}_values_${suffix} };`;
      }
      return `do { const char *${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "text", ${keys.length}, NULL, ${vecName}_values_${suffix} }; } while(0);`;
    }
    if (role === "ob") {
      const allNum = values.every((v) => typeof v === "number");
      const allText = values.every((v) => typeof v === "string");
      const allBool = values.every((v) => typeof v === "boolean");
      if (allNum) {
        const literal = values.map((v) => (typeof v === "number" ? v : Number(v) || 0)).join(", ");
        markDeclared("num");
        if (needsDecl) {
          return `double ${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "num", ${values.length}, ${vecName}_values_${suffix}, NULL };`;
        }
        return `do { double ${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "num", ${values.length}, ${vecName}_values_${suffix}, NULL }; } while(0);`;
      }
      if (allText) {
        const literal = values.map((v) => JSON.stringify(String(v))).join(", ");
        markDeclared("text");
        if (needsDecl) {
          return `const char *${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "text", ${values.length}, NULL, ${vecName}_values_${suffix} };`;
        }
        return `do { const char *${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "text", ${values.length}, NULL, ${vecName}_values_${suffix} }; } while(0);`;
      }
      if (allBool) {
        const literal = values.map((v) => (v ? 1 : 0)).join(", ");
        markDeclared("bool");
        if (needsDecl) {
          return `double ${vecName}_values_${suffix}[] = { ${literal} };\npya_vec ${vecName} = { "bool", ${values.length}, ${vecName}_values_${suffix}, NULL };`;
        }
        return `do { double ${vecName}_values_${suffix}[] = { ${literal} }; ${vecName} = (pya_vec){ "bool", ${values.length}, ${vecName}_values_${suffix}, NULL }; } while(0);`;
      }
      return "/* TODO: json map enumeration supports scalar values only for C */";
    }
    return "/* TODO: json map enumeration full entries not yet supported for C */";
  }
  if (role === "su") {
    markDeclared("text");
    if (needsDecl) {
      return `let ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "text", values: ${JSON.stringify(keys)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
    }
    return `${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "text", values: ${JSON.stringify(keys)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
  }
  if (role === "ob") {
    const type = values.every((v) => typeof v === "number")
      ? "num"
      : values.every((v) => typeof v === "string")
        ? "text"
        : values.every((v) => typeof v === "boolean")
          ? "bool"
          : "raw";
    markDeclared(type === "raw" ? "num" : type);
    if (needsDecl) {
      return `let ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "${type}", values: ${JSON.stringify(values)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
    }
    return `${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "${type}", values: ${JSON.stringify(values)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
  }
  markDeclared("raw");
  const entries = keys.map((key) => ({ ve: { type: "raw", values: [key, jsonObj[key]] } }));
  if (needsDecl) {
    return `let ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "raw", values: ${JSON.stringify(entries)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
  }
  return `${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: { type: "raw", values: ${JSON.stringify(entries)} } }, be: "vector", mood: "ya" };\nglobalThis[${JSON.stringify(targetName)}] = ${targetVar};`;
}
