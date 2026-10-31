export function handleVectorLiteral({
  sentence,
  effectiveBe,
  ob,
  lang,
  sentenceArg,
  name,
  shouldDeclare,
  locals,
  localsTypes,
  declared,
  declaredVectorTypes,
  cHelpers,
  cState
} = {}, {
  valueForRole,
  pathFromGenitive,
  sanitizeName,
  markDeclared
} = {}) {
  if (effectiveBe !== "vector" || !ob.ve?.values) return null;
  const fillCountExpr = (() => {
    if (typeof sentence.by?.num === "number") return String(Math.trunc(sentence.by.num));
    if (sentence.by?.name) {
      const base = sanitizeName(sentence.by.name);
      if (declared?.has(base) || locals?.has(base)) return `(${base}?.ob?.num ?? 0)`;
    }
    if (sentence.by?.genitive && !sentenceArg) {
      const chain = sentence.by.genitive.chain || [];
      const root = chain[0];
      if (typeof root === "string") {
        const base = sanitizeName(root);
        if (declared?.has(base) || locals?.has(base)) {
          const path = pathFromGenitive(sentence.by.genitive, "IGNORED", { locals, declared });
          if (chain.length === 3 && chain[1] === "ob" && chain[2] === "num") return `(${base}?.ob?.num ?? 0)`;
        }
      }
    }
    return null;
  })();

  const rawType = ob.ve.type || "num";
  const vecType = rawType === "number" ? "num" : rawType;
  if (fillCountExpr && ob.ve.values.length === 1) {
    const elem = ob.ve.values[0];
    const elemLiteral = typeof elem === "number" ? String(elem) : JSON.stringify(elem);
    const vecLiteral = `{ type: \"${vecType}\", values: Array(${fillCountExpr}).fill(${elemLiteral}) }`;
    if (sentenceArg) {
      const target = valueForRole("su", sentenceArg, "ve", sentence.su) ?? name;
      return `${target} = ${vecLiteral};`;
    }
    const sentenceObject = `{ su: { name: \"${name}\" }, ob: { ve: ${vecLiteral} }, be: \"${effectiveBe}\", exists: ${shouldDeclare}, mood: \"ya\" }`;
    if (lang === "c") {
      const isLiteralCount = /^\d+$/.test(String(fillCountExpr));
      if (!isLiteralCount) return `/* TODO: vector fill with dynamic count in C */`;
      const count = Number(fillCountExpr);
      const suffix = cState ? cState.vectorCounter++ : 0;
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      if (vecType === "bool") {
        const val = elem === "truth" || elem === true || elem === 1 ? 1 : 0;
        const values = Array(count).fill(val).join(", ");
        if (shouldDeclare) {
          return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { \"bool\", ${count}, ${name}_values, NULL };`;
        }
        return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ \"bool\", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
      }
      if (vecType === "text") {
        const val = JSON.stringify(String(elem));
        const values = Array(count).fill(val).join(", ");
        if (shouldDeclare) {
          return `const char *${name}_values[] = { ${values} };\npya_vec ${name} = { \"text\", ${count}, NULL, ${name}_values };`;
        }
        return `do { const char *${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ \"text\", ${count}, NULL, ${name}_values_${suffix} }; } while(0);`;
      }
      if (vecType !== "num") return `/* TODO: vector support in C for ${vecType} */`;
      const numVal = typeof elem === "number" ? elem : Number(elem) || 0;
      const values = Array(count).fill(numVal).join(", ");
      if (shouldDeclare) {
        return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { \"num\", ${count}, ${name}_values, NULL };`;
      }
      return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ \"num\", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
    }
    return shouldDeclare
      ? `${shouldDeclare ? "let" : ""} ${sanitizeName(name)} = ${sentenceObject};\nglobalThis[${JSON.stringify(name)}] = ${sanitizeName(name)};`
      : sentenceObject;
  }

  const values = ob.ve.values
    .map(v => (typeof v === "number" ? v : JSON.stringify(v)))
    .join(", ");
  const vecLiteral = `{ type: \"${vecType}\", values: [${values}] }`;
  if (sentenceArg) {
    const target = valueForRole("su", sentenceArg, "ve", sentence.su) ?? name;
    return `${target} = ${vecLiteral};`;
  }
  const sentenceObject = `{ su: { name: \"${name}\" }, ob: { ve: ${vecLiteral} }, be: \"${effectiveBe}\", exists: ${shouldDeclare}, mood: \"ya\" }`;
  if (lang === "c") {
    const suffix = cState ? cState.vectorCounter++ : 0;
    if (cHelpers) {
      cHelpers.usesVectorType = true;
      cHelpers.usesVectorPrinter = true;
      cHelpers.usesString = true;
      cHelpers.usesCtype = true;
    }
    const cName = sanitizeName(name);
    const count = ob.ve.values.length;
    if (vecType === "text") {
      const values = ob.ve.values.map(v => JSON.stringify(String(v))).join(", ");
      if (shouldDeclare) {
        return `const char *${cName}_values[] = { ${values} };\npya_vec ${cName} = { \"text\", ${count}, NULL, ${cName}_values };`;
      }
      return `do { const char *${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ \"text\", ${count}, NULL, ${cName}_values_${suffix} }; } while(0);`;
    }
    if (vecType === "bool") {
      const values = ob.ve.values
        .map(v => (v === "truth" || v === true || v === 1 ? 1 : 0))
        .join(", ");
      if (shouldDeclare) {
        return `double ${cName}_values[] = { ${values} };\npya_vec ${cName} = { \"bool\", ${count}, ${cName}_values, NULL };`;
      }
      return `do { double ${cName}_values_${suffix}[] = { ${values} }; ${cName} = (pya_vec){ \"bool\", ${count}, ${cName}_values_${suffix}, NULL }; } while(0);`;
    }
    if (vecType !== "num") {
      return `/* TODO: vector support in C for ${vecType} */`;
    }
    const numValues = ob.ve.values
      .map(v => (typeof v === "number" ? v : Number(v) || 0))
      .join(", ");
    if (shouldDeclare) {
      return `double ${cName}_values[] = { ${numValues} };\npya_vec ${cName} = { \"num\", ${count}, ${cName}_values, NULL };`;
    }
    return `do { double ${cName}_values_${suffix}[] = { ${numValues} }; ${cName} = (pya_vec){ \"num\", ${count}, ${cName}_values_${suffix}, NULL }; } while(0);`;
  }
  const varName = sanitizeName(name);
  if (shouldDeclare) {
    return `let ${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
  }
  return `${varName} = ${sentenceObject};\nglobalThis[\"${name}\"] = ${varName};`;
}
