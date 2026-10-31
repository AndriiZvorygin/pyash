export function handleVectorProduce(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    sentenceArg,
    locals,
    declared
  } = context;
  const { vectorValuesExpr, sanitizeName, lvalueForName } = helpers;

  if (!(baseBe === "produce" && (ob?.ve || ob?.name || sentence.by || sentence.from))) return null;
  const leftSlot = (ob && Object.keys(ob).length) ? ob : sentence.from;
  const leftVec = vectorValuesExpr(leftSlot, { sentenceArg, locals, declared });
  const rightVec = vectorValuesExpr(sentence.by || sentence.from, { sentenceArg, locals, declared });
  const targetName = sentence.to?.name || "result";
  const targetBase = sanitizeName(targetName);
  const targetLval = lvalueForName(targetName, { declared, locals, field: "num" });

  const resultName = targetName === "result" ? targetName : "result";
  const resultBase = sanitizeName(resultName);
  const resultLval = lvalueForName(resultName, { declared, locals, field: "num" });

  const lines = [];
  lines.push(`const _a = ${leftVec};`);
  lines.push(`const _b = ${rightVec};`);
  lines.push(`if (_a.length !== _b.length) throw new Error("produce: vectors must be the same length");`);
  lines.push(`let _sum = 0;`);
  lines.push(`for (let i = 0; i < _a.length; i++) { const x = Number(_a[i]); const y = Number(_b[i]); if (Number.isNaN(x) || Number.isNaN(y)) throw new Error("produce: numeric values required"); _sum += x * y; }`);

  const ensureTargetObject = () => {
    if (!declared?.has(targetBase) && !locals?.has(targetBase)) {
      lines.push(`let ${targetBase} = { su: { name: "${targetName}" }, ob: {}, be: "number", mood: "ya" };`);
      declared?.add(targetBase);
    }
  };
  const ensureResultObject = () => {
    if (!declared?.has(resultBase) && !locals?.has(resultBase)) {
      lines.push(`let ${resultBase} = { su: { name: "${resultName}" }, ob: {}, be: "number", mood: "ya" };`);
      declared?.add(resultBase);
    }
  };

  ensureTargetObject();
  const targetAssign = targetLval.includes(".ob.") ? targetLval : `${targetBase}.ob.num`;
  lines.push(`${targetAssign} = _sum;`);

  ensureResultObject();
  const resultAssign = resultLval.includes(".ob.") ? resultLval : `${resultBase}.ob.num`;
  lines.push(`${resultAssign} = _sum;`);

  return lines.join("\n");
}
