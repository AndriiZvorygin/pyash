import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

export function handleNativeExists(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, rememberFlag } = context;
  const { sanitizeName, markDeclared, inlineSentenceLiteral } = helpers;
  if (baseBe !== "exists") return null;
  const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!targetExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: exists target missing",
      from: { name: "compile" },
      raw: { sentence }
    });
  }
  const targetName = sentence.su?.name ?? "result";
  const targetVar = sanitizeName(targetName);
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesSysStat = true;
    }
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar) && !declared?.has(targetName);
    const lines = [];
    if (needsDecl) {
      lines.push(`char ${targetVar}[PYA_TEXT_CAP] = \"\";`);
      markDeclared(declared, targetName);
    }
    if (declaredTypes) declaredTypes.set(targetName, "text");
    lines.push(`{ struct stat st; int __pyaExists = (stat(${targetExpr}, &st) == 0); snprintf(${targetVar}, sizeof(${targetVar}), \"%s\", __pyaExists ? \"truth\" : \"lie\"); }`);
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesResolveFilename = true;
    jsHelpers.usesBoolHelper = true;
  }
  if (rememberFlag) rememberFlag.used = true;
  const needsDecl = !declared?.has(targetName) && !declared?.has(targetVar);
  const lines = [];
  if (needsDecl) {
    lines.push(`let ${targetVar};`);
  }
  lines.push("{");
  lines.push(`  const __pyaExists = (() => { const __pyaTarget = ${targetExpr}; if (!__pyaTarget) throw new Error(\"exists target missing\"); return fs.existsSync(String(__pyaTarget)); })();`);
  lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { boolean: __pyaExists, text: (__pyaExists ? \"truth\" : \"lie\") }, be: \"exists\", mood: \"ya\" };`);
  lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
  lines.push(`  globalThis.result = { ...${targetVar}, su: { name: \"result\" } };`);
  lines.push("}");
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "text");
  return lines.join("\n");
}
