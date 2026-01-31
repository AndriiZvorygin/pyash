import { boolExprForClause } from "../emit_native_helpers.mjs";

export function handleNativeBoolean(context, helpers) {
  const { sentence, baseBe, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, cState, rememberFlag } = context;
  const { sanitizeName, markDeclared } = helpers;
  if (baseBe !== "and" && baseBe !== "or" && baseBe !== "not") return null;
  const targetName = sentence.su?.name ?? "result";
  const targetVar = sanitizeName(targetName);
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesSysStat = true;
    }
    const clause = boolExprForClause(sentence, { ...context, cState }, helpers);
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar) && !declared?.has(targetName);
    const lines = [];
    if (clause.lines?.length) lines.push(...clause.lines);
    if (needsDecl) {
      lines.push(`char ${targetVar}[PYA_TEXT_CAP] = \"\";`);
      markDeclared(declared, targetName);
    }
    if (declaredTypes) declaredTypes.set(targetName, "text");
    lines.push(`snprintf(${targetVar}, sizeof(${targetVar}), \"%s\", ${clause.valueVar} ? \"truth\" : \"lie\");`);
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesResolveFilename = true;
    jsHelpers.usesBoolHelper = true;
  }
  if (rememberFlag) rememberFlag.used = true;
  const clause = boolExprForClause(sentence, context, helpers);
  const needsDecl = !declared?.has(targetName) && !declared?.has(targetVar);
  const lines = [];
  if (needsDecl) {
    lines.push(`let ${targetVar};`);
  }
  lines.push("{");
  lines.push(`  const __pyaBool = Boolean(${clause.valueExpr});`);
  lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { boolean: __pyaBool, text: (__pyaBool ? \"truth\" : \"lie\") }, be: ${JSON.stringify(baseBe)}, mood: \"ya\" };`);
  lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
  lines.push(`  globalThis.result = { ...${targetVar}, su: { name: \"result\" } };`);
  lines.push("}");
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "text");
  return lines.join("\n");
}
