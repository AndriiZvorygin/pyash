import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

function declareCResult(context, helpers) {
  const { declared, declaredTypes, cHelpers, cState } = context;
  const { markDeclared, sanitizeName } = helpers;
  const targetName = "result";
  const targetVar = sanitizeName(targetName);
  if (!cState.resultDeclared) {
    cState.resultDeclared = true;
    cState.preMain.push("char " + targetVar + "[PYA_TEXT_CAP] = \"\";");
  }
  markDeclared(declared, targetName);
  declaredTypes?.set(targetName, "filename");
  if (cHelpers) cHelpers.usesTextHelper = true;
  return targetVar;
}

function declareJsResult(context, helpers, resolvedExpr) {
  const { declared, declaredTypes, locals } = context;
  const { markDeclared, sanitizeName } = helpers;
  const targetName = "result";
  const targetVar = sanitizeName(targetName);
  const needsDecl = !locals?.has(targetVar) && !declared?.has(targetName) && !declared?.has(targetVar);
  markDeclared(declared, targetName);
  declaredTypes?.set(targetName, "filename");
  locals?.add(targetVar);
  const assignment = "{ su: { name: " + JSON.stringify(targetName) + " }, ob: { filename: " + resolvedExpr + " }, be: \"rename\", mood: \"ya\" }";
  return (needsDecl ? "let " + targetVar + " = " + assignment + ";" : targetVar + " = " + assignment + ";") + "\nglobalThis.result = " + targetVar + ";";
}

export function handleNativeRename(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, cHelpers, jsHelpers, cState } = context;
  const { sanitizeName, inlineSentenceLiteral, markDeclared } = helpers;
  if (baseBe !== "rename") return null;
  const sourceExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  const destExpr = resolveFilenameLiteral(sentence.to, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!sourceExpr || !destExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: rename target missing",
      from: { name: "compile" },
      raw: { sentence }
    });
  }
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesSysStat = true;
      cHelpers.usesErrno = true;
      cHelpers.usesFilesystem = true;
    }
    const resultVar = declareCResult(context, { markDeclared, sanitizeName });
    const lines = ["{", "  const char *__pyaSourceRaw = " + sourceExpr + ";", "  const char *__pyaDestRaw = " + destExpr + ";", "  char __pyaSource[PYA_TEXT_CAP];", "  char __pyaDest[PYA_TEXT_CAP];"];
    lines.push("  if (!__pyaSourceRaw || !*__pyaSourceRaw || !__pyaDestRaw || !*__pyaDestRaw || !pya_fs_resolve_path(__pyaSourceRaw, __pyaSource) || !pya_fs_resolve_path(__pyaDestRaw, __pyaDest)) { fprintf(stderr, \"rename defective\\n\"); exit(1); }");
    lines.push("  struct stat __pyaSourceStat;");
    lines.push("  if (!__pyaSource || !*__pyaSource || stat(__pyaSource, &__pyaSourceStat) != 0) { fprintf(stderr, \"rename target missing\\n\"); exit(1); }");
    lines.push("  if (strcmp(__pyaSource, __pyaDest) == 0) { snprintf(" + resultVar + ", PYA_TEXT_CAP, \"%s\", __pyaDest); }");
    lines.push("  else {");
    lines.push("  struct stat __pyaDestStat;");
    lines.push("  int __pyaDestExists = (__pyaDest && *__pyaDest && stat(__pyaDest, &__pyaDestStat) == 0);");
    lines.push("  if (__pyaDestExists && !S_ISREG(__pyaDestStat.st_mode)) { fprintf(stderr, \"rename defective\\n\"); exit(1); }");
    lines.push("  char __pyaParent[PYA_TEXT_CAP];");
    lines.push("  snprintf(__pyaParent, sizeof(__pyaParent), \"%s\", __pyaDest);");
    lines.push("  char *__pyaSlash = strrchr(__pyaParent, '/');");
    lines.push("  if (__pyaSlash) { if (__pyaSlash == __pyaParent) { __pyaSlash[1] = '\\0'; } else { *__pyaSlash = '\\0'; } if (__pyaParent[0] && !pya_fs_mkdir_recursive(__pyaParent)) { fprintf(stderr, \"rename defective\\n\"); exit(1); } }");
    lines.push("  if (__pyaDestExists && unlink(__pyaDest) != 0) { fprintf(stderr, \"rename defective\\n\"); exit(1); }");
    lines.push("  if (rename(__pyaSource, __pyaDest) != 0) { fprintf(stderr, \"rename defective\\n\"); exit(1); }");
    lines.push("  snprintf(" + resultVar + ", PYA_TEXT_CAP, \"%s\", __pyaDest);");
    lines.push("  }");
    lines.push("}");
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
    jsHelpers.usesResolveFilename = true;
    jsHelpers.usesExchange = true;
  }
  const lines = ["{", "  const __pyaSource = " + sourceExpr + ";", "  const __pyaDest = " + destExpr + ";", "  const __pyaSourceInfo = pyaResolveAgentPath(__pyaSource);", "  const __pyaDestInfo = pyaResolveAgentPath(__pyaDest);", "  if (__pyaSourceInfo.outside || __pyaDestInfo.outside) {", "    throw new Error(\"rename defective: outside agent cwd (\" + __pyaSourceInfo.agentCwd + \")\");", "  }", "  const __pyaResolvedSource = __pyaSourceInfo.resolved;", "  const __pyaResolvedDest = __pyaDestInfo.resolved;", "  try { fs.statSync(__pyaResolvedSource); } catch (err) { throw new Error(\"rename target missing\"); }", "  if (__pyaResolvedSource === __pyaResolvedDest) {"];
  lines.push("  } else {");
  lines.push("    let __pyaDestStat = null;");
  lines.push("    try { __pyaDestStat = fs.statSync(__pyaResolvedDest); } catch (err) { if (err?.code !== \"ENOENT\") throw new Error(\"rename defective\"); }");
  lines.push("    if (__pyaDestStat && !__pyaDestStat.isFile()) throw new Error(\"rename defective\");");
  lines.push("    try {");
  lines.push("      fs.mkdirSync(path.dirname(__pyaResolvedDest), { recursive: true });");
  lines.push("      if (__pyaDestStat) fs.unlinkSync(__pyaResolvedDest);");
  lines.push("      fs.renameSync(__pyaResolvedSource, __pyaResolvedDest);");
  lines.push("    } catch (err) {");
  lines.push("      throw new Error(\"rename defective\");");
  lines.push("    }");
  lines.push("  }");
  lines.push("  " + declareJsResult(context, { markDeclared, sanitizeName }, "__pyaResolvedDest").replace(/\n/g, "\n  "));
  lines.push("}");
  return lines.join("\n");
}
