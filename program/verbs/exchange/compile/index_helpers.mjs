export function indexExprFromAt(atSlot, { sentenceArg, locals, declared, localsTypes, declaredTypes, allowCGlobals = false, pathFromGenitive } = {}) {
  if (!atSlot) return null;
  const atNum = atSlot.num;
  const atGenitive = atSlot.genitive;
  if (atNum != null) {
    const idxVal = Number(atNum);
    return Number.isNaN(idxVal) ? atNum : idxVal;
  }
  if (!atGenitive) return null;
  const genChain = Array.isArray(atGenitive?.chain) ? atGenitive.chain : [];
  if (sentenceArg && genChain.length === 3 && genChain[0] === "this" && genChain[2] === "num") {
    return `${sentenceArg}.${genChain[1]}?.num ?? ${sentenceArg}.${genChain[1]}`;
  }
  return pathFromGenitive(atGenitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals });
}
