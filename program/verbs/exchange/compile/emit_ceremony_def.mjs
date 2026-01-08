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

export function transpileCeremony(defSentence, bodySentences, { lang, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState, throwErrorSentence, deriveSignatureFromDefinition, joinSignatureWords, sanitizeName, transpileSentence }) {
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
  for (const s of bodySentences) {
    const line = transpileSentence(s, { lang, sentenceArg: lang === "c" ? undefined : "sentence", locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState });
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
        ? "return;"
        : "return sentence;";

  if (lang === "c") {
    const paramList = "void";
    const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
    return `void ${fnName}(${paramList}) {\n${body}\n}`;
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
  ceremonyFns.set(sentence.su?.name, fnName);
  if (signatureWords) {
    ceremonyFns.set(joinSignatureWords(signatureWords), fnName);
  }
  const usesRememberShim = typeof fn === "string" && fn.includes("remember(");
  const usesMapShim = typeof fn === "string" && fn.includes("runAtAll(");
  return { endIndex: j, fn, usesRememberShim, usesMapShim };
}
