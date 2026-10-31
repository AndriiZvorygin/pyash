export function handleMathMultiplyDivide(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    localsTypes,
    declared,
    declaredTypes
  } = context;
  const { sanitizeName, targetPath, lvalueForName, pathFromGenitive, exprForSlot } = helpers;

  if (
    baseBe === "multiply" &&
    sentence.by &&
    (sentence.ob || sentence.from) &&
    (sentence.to?.name || sentenceArg) &&
    (sentence.by?.name || sentence.by?.genitive || sentence.by?.thisRef || sentence.ob?.name || sentence.ob?.genitive || sentence.ob?.thisRef || sentence.from?.name || sentence.from?.genitive || sentence.from?.thisRef)
  ) {
    const lhsSlot = sentence.ob ?? sentence.from;
    const rhsSlot = sentence.by;
    const numericExpr = (slot) => {
      if (!slot) return "0";
      if (slot.num !== undefined) {
        const n = Number(slot.num);
        return Number.isNaN(n) ? "0" : String(n);
      }
      if (slot.name) {
        const base = sanitizeName(slot.name);
        if (lang === "c") {
          if (locals?.has(base) || declared?.has(base)) return base;
          return base;
        }
        if (localsTypes?.get(base) === "number" || declaredTypes?.get(base) === "number") {
          return `${base}.ob?.num ?? ${base}`;
        }
        if (locals?.has(base)) return base;
        if (declared?.has(base)) return `${base}.ob?.num ?? ${base}`;
        return base;
      }
      const direct = exprForSlot(slot, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (direct) return direct;
      return "0";
    };
    const lhsExpr = numericExpr(lhsSlot);
    const rhsExpr = numericExpr(rhsSlot);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        if (localsTypes) localsTypes.set(baseName, "number");
        lines.push(`${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
    }
    if (lang === "c") {
      const baseName = sanitizeName(sentence.to.name);
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) locals?.add(baseName);
      return needsDecl
        ? `double ${baseName} = (${lhsExpr}) * (${rhsExpr});`
        : `${baseName} = (${lhsExpr}) * (${rhsExpr});`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
  }

  if (baseBe === "multiply" && ob.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "divide" && ob.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
    const divisor = Number.isNaN(safeValue) ? 1 : safeValue;
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) / ${divisor};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) / ${divisor};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} / ${divisor};`;
    }
    return `${sentence.to.name}.ob = ${sentence.to.name}.ob ?? {};\n${sentence.to.name}.ob.num = (${sentence.to.name}.ob.num ?? 0) / ${divisor};`;
  }

  return null;
}
