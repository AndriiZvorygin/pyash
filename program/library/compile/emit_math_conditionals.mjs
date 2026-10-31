export function handleMathConditional(context, helpers) {
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
  const { exprForSlot, sanitizeName, targetPath, transpileSentence, cExpr } = helpers;

  if (!(sentence.consequence && (baseBe === "tiny" || baseBe === "giant" || baseBe === "equally"))) return null;
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
  const cLhs = lang === "c" ? cExpr(lhs) : lhs;
  const cRhs = lang === "c" ? cExpr(rhs) : rhs;
  const jsLhs = `(${lhs})`;
  const jsRhs = `(${rhs})`;
  const cLhsWrapped = `(${cLhs})`;
  const cRhsWrapped = `(${cRhs})`;
  if (lang === "c" && comparesText && baseBe === "equally") {
    return `if (strcmp(${cLhsWrapped}, ${cRhsWrapped}) == 0) {\n${finalBody}\n}`;
  }
  return `if (${lang === "c" ? cLhsWrapped : jsLhs} ${op} ${lang === "c" ? cRhsWrapped : jsRhs}) {\n${finalBody}\n}`;
}
