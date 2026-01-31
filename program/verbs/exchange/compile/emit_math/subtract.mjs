export function handleMathSubtract(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    localsTypes,
    declared
  } = context;
  const { sanitizeName, targetPath, lvalueForName, pathFromGenitive } = helpers;
  if (baseBe !== "subtract" || ob.num === undefined || (!sentence.to?.name && !sentence.from?.name && !sentenceArg)) return null;
  const safeValue = typeof ob.num === "number" ? ob.num : Number(ob.num);
  if (sentenceArg) {
    const targetSlot = sentence.to ?? sentence.from;
    const targetRole = sentence.to ? "to" : "from";
    const hasGenitive = Boolean(targetSlot?.genitive);
    if (!hasGenitive && targetSlot?.name) {
      const baseName = sanitizeName(targetSlot.name);
      const lines = [];
      if (!locals?.has(baseName) && !declared?.has(baseName)) {
        lines.push(`let ${baseName};`);
        locals?.add(baseName);
        if (localsTypes) localsTypes.set(baseName, "number");
      }
      if (lang === "c") {
        lines.push(`${baseName} = (${baseName} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
      } else {
        lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
        lines.push(`${baseName}.ob.num = (${baseName}.ob.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
      }
      return lines.join("\n");
    }
    const target = targetPath(targetRole, sentenceArg, "num", targetSlot, { locals, declared }) ?? targetSlot?.name;
    return `${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }
  const targetSlot = sentence.to ?? sentence.from;
  const targetName = targetSlot?.name;
  if (!targetName) return `// TODO: ${JSON.stringify(sentence)}`;
  if (lang === "c") {
    return `${targetName} = ${targetName} - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }
  return `${targetName}.ob = ${targetName}.ob ?? {};\n${targetName}.ob.num = (${targetName}.ob.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
}
