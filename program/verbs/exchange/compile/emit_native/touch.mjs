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

function declareJsResult(context, helpers, resolvedExpr, be) {
  const { declared, declaredTypes, locals, jsHelpers } = context;
  const { markDeclared, sanitizeName } = helpers;
  const targetName = "result";
  const targetVar = sanitizeName(targetName);
  const needsDecl = !locals?.has(targetVar) && !declared?.has(targetName) && !declared?.has(targetVar);
  markDeclared(declared, targetName);
  declaredTypes?.set(targetName, "filename");
  locals?.add(targetVar);
  if (jsHelpers) jsHelpers.usesExchange = true;
  const assignment = "{ su: { name: " + JSON.stringify(targetName) + " }, ob: { filename: " + resolvedExpr + " }, be: " + JSON.stringify(be) + ", mood: \"ya\" }";
  return (needsDecl ? "let " + targetVar + " = " + assignment + ";" : targetVar + " = " + assignment + ";") + "\nglobalThis.result = " + targetVar + ";";
}

export function handleNativeTouch(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, cHelpers, jsHelpers, cState } = context;
  const { sanitizeName, inlineSentenceLiteral, markDeclared } = helpers;
  if (baseBe !== "touch") return null;
  const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!targetExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: touch target missing",
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
    const lines = ["{", "  const char *__pyaTargetRaw = " + targetExpr + ";", "  char __pyaTarget[PYA_TEXT_CAP];"];
    lines.push("  if (!__pyaTargetRaw || !*__pyaTargetRaw) { fprintf(stderr, \"touch target missing\\n\"); exit(1); }");
    lines.push("  if (!pya_fs_resolve_path(__pyaTargetRaw, __pyaTarget)) { fprintf(stderr, \"touch defective\\n\"); exit(1); }");
    lines.push("  char __pyaParent[PYA_TEXT_CAP];");
    lines.push("  snprintf(__pyaParent, sizeof(__pyaParent), \"%s\", __pyaTarget);");
    lines.push("  char *__pyaSlash = strrchr(__pyaParent, '/');");
    lines.push("  if (__pyaSlash) { if (__pyaSlash == __pyaParent) { __pyaSlash[1] = '\\0'; } else { *__pyaSlash = '\\0'; } if (__pyaParent[0] && !pya_fs_mkdir_recursive(__pyaParent)) { fprintf(stderr, \"touch defective\\n\"); exit(1); } }");
    lines.push("  FILE *__pyaFile = fopen(__pyaTarget, \"ab\");");
    lines.push("  if (!__pyaFile) { fprintf(stderr, \"touch defective\\n\"); exit(1); }");
    lines.push("  fclose(__pyaFile);");
    lines.push("  struct timespec __pyaTimes[2];");
    lines.push("  if (clock_gettime(CLOCK_REALTIME, &__pyaTimes[0]) != 0) { fprintf(stderr, \"touch defective\\n\"); exit(1); }");
    lines.push("  __pyaTimes[1] = __pyaTimes[0];");
    lines.push("  if (utimensat(AT_FDCWD, __pyaTarget, __pyaTimes, 0) != 0) { fprintf(stderr, \"touch defective\\n\"); exit(1); }");
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
  const lines = ["{", "  const __pyaTarget = " + targetExpr + ";", "  const __pyaResolvedInfo = pyaResolveAgentPath(__pyaTarget);", "  if (__pyaResolvedInfo.outside) {", "    throw new Error(\"touch defective: outside agent cwd (\" + __pyaResolvedInfo.agentCwd + \")\");", "  }", "  const __pyaResolved = __pyaResolvedInfo.resolved;", "  try {", "    fs.mkdirSync(path.dirname(__pyaResolved), { recursive: true });", "    const __pyaFile = fs.openSync(__pyaResolved, \"a\");", "    fs.closeSync(__pyaFile);", "    const __pyaNow = new Date();", "    fs.utimesSync(__pyaResolved, __pyaNow, __pyaNow);", "  } catch (err) {", "    throw new Error(\"touch defective\");", "  }"];
  lines.push("  " + declareJsResult(context, { markDeclared, sanitizeName }, "__pyaResolved", "touch").replace(/\n/g, "\n  "));
  lines.push("}");
  return lines.join("\n");
}
