const SEQUENCE_REGISTERS = new Set(["fromindex", "toindex", "atindex"]);

function collectSequenceDeps(sentences) {
  const deps = new Set();

  const scanValue = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.thisRef && SEQUENCE_REGISTERS.has(value.thisRef)) {
      deps.add(value.thisRef);
    }
    if (value.genitive?.chain) {
      const chain = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
      if (chain.includes("this")) {
        for (const reg of SEQUENCE_REGISTERS) {
          if (chain.includes(reg)) deps.add(reg);
        }
      }
    }
    if (Array.isArray(value)) value.forEach(scanValue);
  };
  const scanSentence = (sentence) => {
    if (!sentence || typeof sentence !== "object") return;
    for (const [key, value] of Object.entries(sentence)) {
      if (key === "consequence") {
        scanSentence(value);
        continue;
      }
      scanValue(value);
    }
  };

  if (Array.isArray(sentences)) {
    sentences.forEach(scanSentence);
  } else {
    scanSentence(sentences);
  }

  return deps;
}

export function transpileCeremony(defSentence, bodySentences, { lang, declared, declaredTypes, declaredVectorTypes, ceremonyFns, ceremonyReturnTypes, cHelpers, jsHelpers, cState, throwErrorSentence, deriveSignatureFromDefinition, joinSignatureWords, sanitizeName, transpileSentence }) {
  const seqDeps = collectSequenceDeps(bodySentences);
  for (const reg of seqDeps) {
    if (!defSentence?.[reg]) {
      throwErrorSentence({
        name: "sequence register missing",
        message: `ceremony "${defSentence?.su?.name ?? "ceremony"}" reads this ${reg} but definition omits ${reg}`,
        from: { name: "compile" },
        raw: { ceremony: defSentence?.su?.name, missing: reg }
      });
    }
  }

  const signatureWords = deriveSignatureFromDefinition(defSentence);
  const fnBaseName = signatureWords
    ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
    : (defSentence?.su?.name || "ceremony");
  const fnName = sanitizeName(fnBaseName);

  const bodyLines = [];
  let hasReturn = false;
  const locals = new Set();
  const localsTypes = new Map();
  const scopedDeclared = new Set(declared ? [...declared] : []);
  const scopedDeclaredTypes = new Map(declaredTypes ? [...declaredTypes.entries()] : []);
  const paramMacros = [];
  const paramUndefs = [];
  const addParamMacro = (slot, role) => {
    if (!slot?.name) return;
    const name = sanitizeName(slot.name);
    const typeWords = Array.isArray(slot.nameTypeWords) ? slot.nameTypeWords : [];
    const isText = typeWords.includes("text") || typeWords.includes("filename");
    const isBool = typeWords.includes("bool") || typeWords.includes("boolean");
    let reg = null;
    if (role === "to") reg = isText ? "pya_to_text" : (isBool ? "pya_to_bool" : "pya_to_num");
    if (role === "ob") reg = isText ? "pya_ob_text" : (isBool ? "pya_ob_bool" : "pya_ob_num");
    if (role === "from") reg = "pya_from_num";
    if (role === "by") reg = "by";
    if (!reg) return;
    paramMacros.push(`#define ${name} ${reg}`);
    paramUndefs.push(`#undef ${name}`);
    locals.add(name);
  };
  if (lang === "c") {
    addParamMacro(defSentence.to, "to");
    addParamMacro(defSentence.ob, "ob");
    addParamMacro(defSentence.from, "from");
    addParamMacro(defSentence.by, "by");

    const rememberAliases = new Map();
    for (const s of bodySentences) {
      if (s?.mood !== "do" || s?.be !== "remember") continue;
      const rawName = s.to?.name?.split(" ")[0];
      if (!rawName) continue;
      const chain = s.ob?.genitive?.chain;
      if (!Array.isArray(chain) || chain[0] !== "this") continue;
      const head = chain[1];
      const wantsText = chain.includes("text");
      const wantsBool = chain.includes("bool") || chain.includes("boolean");
      let reg = null;
      if (head === "to") reg = wantsText ? "pya_to_text" : (wantsBool ? "pya_to_bool" : "pya_to_num");
      if (head === "ob") reg = wantsText ? "pya_ob_text" : (wantsBool ? "pya_ob_bool" : "pya_ob_num");
      if (head === "from") reg = "pya_from_num";
      if (head === "by") reg = "by";
      if (reg) rememberAliases.set(rawName, reg);
    }
    for (const [name, reg] of rememberAliases.entries()) {
      const safeName = sanitizeName(name);
      paramMacros.push(`#define ${safeName} ${reg}`);
      paramUndefs.push(`#undef ${safeName}`);
      locals.add(safeName);
    }
  }
  for (const s of bodySentences) {
    const line = transpileSentence(s, {
      lang,
      sentenceArg: lang === "c" ? undefined : "sentence",
      locals,
      localsTypes,
      declared: scopedDeclared,
      declaredTypes: scopedDeclaredTypes,
      declaredVectorTypes,
      ceremonyFns,
      ceremonyReturnTypes,
      cHelpers,
      jsHelpers,
      cState
    });
    if (line) {
      bodyLines.push(line);
      if (line.includes("return")) {
        hasReturn = true;
        break; // stop emitting after first return
      }
    }
  }
  const retLine =
    hasReturn
      ? null
      : lang === "c"
        ? "return pya_value_none();"
        : "return sentence;";

  if (lang === "c") {
    const paramList = "void";
    const body = [...paramMacros, ...bodyLines, ...(retLine ? [retLine] : []), ...paramUndefs].map(l => `  ${l}`).join("\n");
    if (cHelpers) {
      cHelpers.usesCeremonyValue = true;
      cHelpers.usesMapGlobals = true;
    }
    return `pya_value ${fnName}(${paramList}) {\n${body}\n}`;
  }

  const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
  return `function ${fnName}(sentence) {\n${body}\n}\n` +
    `globalThis[${JSON.stringify(fnBaseName)}] = ${fnName};`;
}

export function handleCeremonyDefinition(context, helpers) {
  const {
    sentence,
    sentences,
    index,
    lang,
    declared,
    declaredTypes,
    declaredVectorTypes,
    ceremonyFns,
    ceremonyReturnTypes,
    cHelpers,
    jsHelpers,
    cState
  } = context;
  const {
    deriveSignatureFromDefinition,
    joinSignatureWords,
    sanitizeName,
    transpileSentence,
    throwErrorSentence
  } = helpers;

  if (sentence.mood !== "def" || sentence.be !== "ceremony") return null;

  if (sentence.su?.name && ceremonyFns.has(sentence.su.name)) {
    console.warn(`ceremony redefined: ${sentence.su.name}`);
  }
  const body = [];
  let j = index + 1;
  for (; j < sentences.length; j++) {
    if (sentences[j].mood === "prah") break;
    body.push(sentences[j]);
  }
  const fn = transpileCeremony(sentence, body, {
    lang,
    declared,
    declaredTypes,
    declaredVectorTypes,
    ceremonyFns,
    cHelpers,
    jsHelpers,
    cState,
    throwErrorSentence,
    deriveSignatureFromDefinition,
    joinSignatureWords,
    sanitizeName,
    transpileSentence
  });
  const signatureWords = deriveSignatureFromDefinition(sentence);
  const fnBaseName = signatureWords
    ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
    : (sentence?.su?.name || "ceremony");
  const fnName = sanitizeName(fnBaseName);
  if (ceremonyReturnTypes) {
    const returnType = signatureWords?.includes("text")
      ? "text"
      : signatureWords?.includes("num")
        ? "number"
        : "number";
    ceremonyReturnTypes.set(sentence.su?.name, returnType);
    if (signatureWords) ceremonyReturnTypes.set(joinSignatureWords(signatureWords), returnType);
  }
  ceremonyFns.set(sentence.su?.name, fnName);
  if (signatureWords) {
    ceremonyFns.set(joinSignatureWords(signatureWords), fnName);
  }
  const usesRememberShim = typeof fn === "string" && fn.includes("remember(");
  const usesMapShim = typeof fn === "string" && fn.includes("runAtAll(");
  return { endIndex: j, fn, usesRememberShim, usesMapShim };
}
