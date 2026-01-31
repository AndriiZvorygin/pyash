export function handleMathRemains(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    declared,
    cHelpers
  } = context;
  const { sanitizeName, pathFromGenitive, exprForSlot, targetPath, lvalueForName, cExpr } = helpers;
  if (baseBe !== "remains") return null;
  const hasOb = ob.num !== undefined || sentence.from?.num !== undefined || ob.name || ob.genitive || ob.thisRef;
  if (!hasOb || (!sentence.to?.name && !sentenceArg)) return null;
  if (sentenceArg) {
    const targetGenitive = sentence.to?.genitive ? pathFromGenitive(sentence.to.genitive, sentenceArg, { locals, declared }) : null;
    const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
    const source = (() => {
      if (sentence.ob?.genitive && sentenceArg) return pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared });
      if (ob?.name) {
        const baseName = sanitizeName(ob.name);
        if (locals?.has(baseName)) return `${baseName}.ob?.num`;
      }
      return exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    })();
    const divisorExpr = exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ??
      exprForSlot(ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });

    const lines = [];
    if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
      lines.push(`let ${targetName};`);
      locals?.add(targetName);
    }

    const lhs = targetGenitive
      ? targetGenitive
      : targetName
        ? lvalueForName(targetName, { declared, locals })
        : targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? `${sentenceArg}.ob?.num`;
    const numerator = source ?? lhs;
    const div = divisorExpr ?? "0";
    lines.push(`if ((${div} ?? 0) === 0) throw new Error("remains: from cannot be zero");`);
    const expr = `(${numerator} ?? 0) % (${div} ?? 0)`;
    lines.push(`${lhs} = ${expr};`);
    return lines.join("\n");
  }
  if (lang === "c") {
    const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
    const hasExplicitDivisor = sentence.from != null || sentence.by != null;
    const divisor = hasExplicitDivisor
      ? (exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0")
      : (exprForSlot(sentence.ob, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0");
    const numerator = (!hasExplicitDivisor && sentence.ob?.num !== undefined)
      ? (targetName ?? "0")
      : (exprForSlot(sentence.ob, { sentenceArg, locals, declared, defaultExpr: targetName, field: "num" }) ?? targetName ?? "0");
    const lhs = targetName ?? "result";
    const lines = [];
    if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
      locals?.add(targetName);
      lines.push(`double ${targetName} = 0;`);
    }
    if (cHelpers) cHelpers.usesPrintf = cHelpers.usesPrintf;
    const cDivisor = cExpr(divisor);
    const cNumerator = cExpr(numerator);
    lines.push(`if ((${cDivisor}) == 0) { /* remains: from cannot be zero */ } else { ${lhs} = fmod(${cNumerator}, ${cDivisor}); }`);
    return lines.join("\n");
  }
  const divisorRaw = sentence.from?.num ?? ob.num;
  const divisor = typeof divisorRaw === "number" ? divisorRaw : Number(divisorRaw);
  const safeValue = Number.isNaN(divisor) ? 0 : divisor;
  return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) % ${safeValue};`;
}
