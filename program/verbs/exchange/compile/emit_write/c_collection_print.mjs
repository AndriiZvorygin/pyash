export function handleCCollectionPrint({
  sentence,
  ob,
  lang,
  declaredTypes,
  locals,
  declared,
  cHelpers,
  wantsVector,
  sentenceArg
}, {
  sanitizeName,
  vectorExprFromGenitive
}) {
  if (lang !== "c") return null;

  if (ob.name && declaredTypes?.get(ob.name) === "map") {
    cHelpers.usesMap = true;
    cHelpers.usesMapPrinter = true;
    cHelpers.usesMapGlobals = true;
    cHelpers.usesPrintf = true;
    cHelpers.usesString = true;
    cHelpers.usesStdlib = true;
    cHelpers.usesCtype = true;
    return `print_map_sentence(${JSON.stringify(ob.name)}, &${sanitizeName(ob.name)});`;
  }

  if (ob.name && declaredTypes?.get(ob.name) === "list") {
    cHelpers.usesPrintf = true;
    cHelpers.usesVectorType = true;
    cHelpers.usesVectorPrinter = true;
    cHelpers.usesListPrinter = true;
    cHelpers.usesString = true;
    cHelpers.usesCtype = true;
    return `print_list_sentence(${JSON.stringify(ob.name)}, &${sanitizeName(ob.name)});`;
  }

  if (wantsVector) {
    cHelpers.usesPrintf = true;
    cHelpers.usesVectorType = true;
    cHelpers.usesVectorPrinter = true;
    cHelpers.usesString = true;
    cHelpers.usesCtype = true;
    const vecName = sentence.ob?.name;
    if (vecName && declaredTypes?.get(vecName) === "vector") {
      return `print_vec_sentence(${JSON.stringify(vecName)}, &${sanitizeName(vecName)});`;
    }
    if (sentence.ob?.genitive) {
      const chain = sentence.ob.genitive.chain || [];
      if (chain.length === 2 && chain[1] === "ve" && chain[0] !== "this") {
        const root = sanitizeName(chain[0]);
        if (locals?.has(root) || declared?.has(root)) return `print_vec(&${root});`;
      }
      const vecExpr = vectorExprFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared });
      if (vecExpr && !vecExpr.includes("remember(")) return `print_vec(${vecExpr});`;
    }
  }

  return null;
}
