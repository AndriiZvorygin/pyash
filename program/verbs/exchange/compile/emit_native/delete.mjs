import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

function declareCResult(context, helpers) {
  const { declared, declaredTypes, cHelpers, cState } = context;
  const { markDeclared, sanitizeName } = helpers;
  const targetVar = sanitizeName("result");
  if (!cState.resultDeclared) {
    cState.resultDeclared = true;
    cState.preMain.push("char " + targetVar + "[PYA_TEXT_CAP] = \"\";");
  }
  markDeclared(declared, "result");
  declaredTypes?.set("result", "filename");
  if (cHelpers) cHelpers.usesTextHelper = true;
  return targetVar;
}

export function handleNativeDelete(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, cState } = context;
  const { sanitizeName, inlineSentenceLiteral, markDeclared } = helpers;
  if (baseBe !== "delete") return null;
  const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!targetExpr) {
    throwErrorSentence({ name: "compile error", message: "compile: delete target missing", from: { name: "compile" }, raw: { sentence } });
  }
  const modeRaw = sentence.as?.wo;
  const mode = typeof modeRaw === "string" ? modeRaw.toLowerCase() : "";
  const isRecursive = mode === "recursive";
  const isFileMode = mode === "file";
  const isDirMode = mode === "dir" || mode === "directory";
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesSysStat = true;
      cHelpers.usesDirent = true;
      cHelpers.usesErrno = true;
      cHelpers.usesFilesystem = true;
    }
    const resultVar = declareCResult(context, { markDeclared, sanitizeName });
    const lines = ["{", "  const char *__pyaTargetRaw = " + targetExpr + ";", "  char __pyaTarget[PYA_TEXT_CAP];", "  if (!__pyaTargetRaw || !*__pyaTargetRaw) { fprintf(stderr, \"delete target missing\\n\"); exit(1); }", "  if (!pya_fs_resolve_path(__pyaTargetRaw, __pyaTarget)) { fprintf(stderr, \"delete defective\\n\"); exit(1); }", "  struct stat __pyaStat;", "  if (stat(__pyaTarget, &__pyaStat) != 0) { fprintf(stderr, \"delete target missing\\n\"); exit(1); }", "  if (S_ISDIR(__pyaStat.st_mode)) {"];
    if (isFileMode) {
      lines.push("    fprintf(stderr, \"delete target defective\\n\"); exit(1);");
    } else if (isRecursive) {
      lines.push("    if (!pya_fs_delete_recursive(__pyaTarget)) { fprintf(stderr, \"delete defective\\n\"); exit(1); }");
    } else {
      lines.push("    if (rmdir(__pyaTarget) != 0) { fprintf(stderr, \"delete defective\\n\"); exit(1); }");
    }
    lines.push("  } else {");
    if (isDirMode) lines.push("    fprintf(stderr, \"delete target defective\\n\"); exit(1);");
    else lines.push("    if (unlink(__pyaTarget) != 0) { fprintf(stderr, \"delete defective\\n\"); exit(1); }");
    lines.push("  }");
    lines.push("  snprintf(" + resultVar + ", PYA_TEXT_CAP, \"%s\", __pyaTarget);");
    lines.push("}");
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
    jsHelpers.usesResolveFilename = true;
    jsHelpers.usesExchange = true;
  }
  const lines = ["{", "  const __pyaTarget = " + targetExpr + ";", "  if (!__pyaTarget) throw new Error(\"delete target missing\");", "  const __pyaResolvedInfo = pyaResolveAgentPath(__pyaTarget);", "  if (__pyaResolvedInfo.outside) throw new Error(\"delete defective: outside agent cwd\");", "  const __pyaResolved = __pyaResolvedInfo.resolved;", "  let __pyaStat;", "  try { __pyaStat = fs.statSync(__pyaResolved); } catch (err) { throw new Error(\"delete target missing\"); }", "  if (__pyaStat.isDirectory()) {"];
  if (isFileMode) lines.push("    throw new Error(\"delete target defective\");");
  else if (isRecursive) lines.push("    try { fs.rmSync(__pyaResolved, { recursive: true, force: false }); } catch (err) { throw new Error(\"delete defective\"); }");
  else lines.push("    try { fs.rmdirSync(__pyaResolved); } catch (err) { throw new Error(\"delete defective\"); }");
  lines.push("  } else {");
  if (isDirMode) lines.push("    throw new Error(\"delete target defective\");");
  else lines.push("    try { fs.unlinkSync(__pyaResolved); } catch (err) { throw new Error(\"delete defective\"); }");
  lines.push("  }");
  const targetVar = sanitizeName("result");
  const needsDecl = !declared?.has("result") && !declared?.has(targetVar);
  markDeclared(declared, "result");
  declaredTypes?.set("result", "filename");
  lines.push("  " + (needsDecl ? "let " + targetVar + " =" : targetVar + " =") + " { su: { name: \"result\" }, ob: { filename: __pyaResolved }, be: \"delete\", mood: \"ya\" };");
  lines.push("  globalThis.result = " + targetVar + ";");
  lines.push("}");
  return lines.join("\n");
}
