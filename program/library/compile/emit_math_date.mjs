export function handleDateMath(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    lang,
    sentenceArg,
    locals,
    declared,
    cHelpers,
    jsHelpers
  } = context;
  const { sanitizeName, targetPath } = helpers;

  const durationUnit = ob && ["second", "minute", "hour", "day", "week", "month"].find((unit) => ob[unit] !== undefined);
  if (!(baseBe === "plus" || baseBe === "subtract") || !durationUnit) return null;

  const direction = baseBe === "plus" ? 1 : -1;
  const amountValue = Number(ob[durationUnit]);
  if (Number.isNaN(amountValue)) return `// TODO: ${JSON.stringify(sentence)}`;
  const sourceSlot = baseBe === "plus" ? (sentence.to ?? sentence.from) : sentence.from;
  const targetSlot = sourceSlot;
  const dateExpr = (() => {
    if (!sourceSlot) return null;
    if (sourceSlot.date !== undefined) return JSON.stringify(sourceSlot.date);
    if (sourceSlot.name) {
      const baseName = sanitizeName(sourceSlot.name);
      if (lang === "c") return baseName;
      if (locals?.has(baseName) || declared?.has(baseName)) {
        return `${baseName}.ob?.date ?? ${baseName}.date ?? ${baseName}`;
      }
      return baseName;
    }
    if (sentenceArg) {
      const role = baseBe === "plus" ? (sentence.to ? "to" : "from") : "from";
      return targetPath(role, sentenceArg, "date", sourceSlot, { locals, declared });
    }
    return null;
  })();
  if (!dateExpr) return `// TODO: ${JSON.stringify(sentence)}`;
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesDateMath = true;
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
    }
    const targetName = targetSlot?.name ?? "result";
    const targetVar = sanitizeName(targetName);
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetName);
    if (needsDecl) locals?.add(targetVar);
    const lines = [];
    lines.push(`char _date_buf[PYA_TEXT_CAP];`);
    lines.push(`if (!pya_date_add(${dateExpr}, "${durationUnit}", ${amountValue}, ${direction}, _date_buf, sizeof(_date_buf))) { fprintf(stderr, "date defective\\n"); exit(1); }`);
    if (needsDecl) {
      lines.push(`char ${targetVar}[PYA_TEXT_CAP];`);
    }
    lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", _date_buf);`);
    return lines.join("\n");
  }
  jsHelpers.usesDateMath = true;
  const dateCall = `pyaDateAdd(${dateExpr}, "${durationUnit}", ${amountValue}, ${direction})`;
  if (sentenceArg) {
    const role = baseBe === "plus" ? (sentence.to ? "to" : "from") : "from";
    const target = targetPath(role, sentenceArg, "date", targetSlot, { locals, declared }) ?? targetSlot?.name;
    return `${target} = ${dateCall};`;
  }
  if (targetSlot?.name) {
    const baseName = sanitizeName(targetSlot.name);
    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`let ${baseName} = { su: { name: "${targetSlot.name}" }, ob: {}, be: "date", mood: "ya" };`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.ob = ${baseName}.ob ?? {};`);
    lines.push(`${baseName}.ob.date = ${dateCall};`);
    return lines.join("\n");
  }
  return `globalThis["result"] = { su: { name: "result" }, ob: { date: ${dateCall} }, be: "date", mood: "ya" };`;
}
