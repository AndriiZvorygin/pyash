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

export function handleNativeCopy(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, cState } = context;
  const { sanitizeName, inlineSentenceLiteral, markDeclared } = helpers;
  if (baseBe !== "copy") return null;
  const srcExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  const destExpr = resolveFilenameLiteral(sentence.to, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!srcExpr || !destExpr) {
    throwErrorSentence({ name: "compile error", message: "compile: copy target missing", from: { name: "compile" }, raw: { sentence } });
  }
  const modeRaw = sentence.as?.wo;
  const recursive = typeof modeRaw === "string" && modeRaw.toLowerCase() === "recursive";
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
    const lines = ["{", "  const char *__pyaSrcRaw = " + srcExpr + ";", "  const char *__pyaDestRaw = " + destExpr + ";", "  char __pyaSrc[PYA_TEXT_CAP];", "  char __pyaDest[PYA_TEXT_CAP];"];
    lines.push("  if (!__pyaSrcRaw || !*__pyaSrcRaw || !__pyaDestRaw || !*__pyaDestRaw || !pya_fs_resolve_path(__pyaSrcRaw, __pyaSrc) || !pya_fs_resolve_path(__pyaDestRaw, __pyaDest)) { fprintf(stderr, \"copy defective\\n\"); exit(1); }");
    lines.push("  struct stat __pyaStat;");
    lines.push("  if (stat(__pyaSrc, &__pyaStat) != 0) { fprintf(stderr, \"copy source missing\\n\"); exit(1); }");
    lines.push("  int __pyaSamePath = (strcmp(__pyaSrc, __pyaDest) == 0);");
    if (recursive) {
      lines.push("  if (!S_ISDIR(__pyaStat.st_mode)) { fprintf(stderr, \"copy source defective\\n\"); exit(1); }");
      lines.push("  if (!__pyaSamePath && !pya_fs_copy_dir(__pyaSrc, __pyaDest)) { fprintf(stderr, \"copy defective\\n\"); exit(1); }");
    } else {
      lines.push("  if (!S_ISREG(__pyaStat.st_mode)) { fprintf(stderr, \"copy source defective\\n\"); exit(1); }");
      lines.push("  char __pyaDestDir[PYA_TEXT_CAP];");
      lines.push("  snprintf(__pyaDestDir, sizeof(__pyaDestDir), \"%s\", __pyaDest);");
      lines.push("  char *__pyaSlash = strrchr(__pyaDestDir, '/');");
      lines.push("  if (__pyaSlash) { if (__pyaSlash == __pyaDestDir) { __pyaSlash[1] = '\\0'; } else { *__pyaSlash = '\\0'; } if (__pyaDestDir[0] && !pya_fs_mkdir_recursive(__pyaDestDir)) { fprintf(stderr, \"copy defective\\n\"); exit(1); } }");
      lines.push("  if (!__pyaSamePath && !pya_fs_copy_file(__pyaSrc, __pyaDest)) { fprintf(stderr, \"copy defective\\n\"); exit(1); }");
    }
    lines.push("  snprintf(" + resultVar + ", PYA_TEXT_CAP, \"%s\", __pyaDest);");
    lines.push("}");
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
    jsHelpers.usesResolveFilename = true;
    jsHelpers.usesExchange = true;
  }
  const lines = ["{", "  const __pyaSrc = String(" + srcExpr + ");", "  const __pyaDest = String(" + destExpr + ");", "  const __pyaSrcInfo = pyaResolveAgentPath(__pyaSrc);", "  const __pyaDestInfo = pyaResolveAgentPath(__pyaDest);", "  if (__pyaSrcInfo.outside || __pyaDestInfo.outside) throw new Error(\"copy defective: outside agent cwd\");", "  const __pyaResolvedSrc = __pyaSrcInfo.resolved;", "  const __pyaResolvedDest = __pyaDestInfo.resolved;", "  let __pyaStat;", "  try { __pyaStat = fs.statSync(__pyaResolvedSrc); } catch (err) { throw new Error(\"copy source missing\"); }", "  const __pyaSamePath = __pyaResolvedSrc === __pyaResolvedDest;"];
  if (recursive) {
    lines.push("  if (!__pyaStat.isDirectory()) throw new Error(\"copy source defective\");");
    lines.push("  if (!__pyaSamePath && typeof fs.cpSync !== \"function\") throw new Error(\"copy defective: recursive copy unsupported\");");
    lines.push("  if (!__pyaSamePath) fs.cpSync(__pyaResolvedSrc, __pyaResolvedDest, { recursive: true, force: true });");
  } else {
    lines.push("  if (!__pyaStat.isFile()) throw new Error(\"copy source defective\");");
    lines.push("  if (!__pyaSamePath) { fs.mkdirSync(path.dirname(__pyaResolvedDest), { recursive: true }); fs.copyFileSync(__pyaResolvedSrc, __pyaResolvedDest); }");
  }
  const targetVar = sanitizeName("result");
  const needsDecl = !declared?.has("result") && !declared?.has(targetVar);
  markDeclared(declared, "result");
  declaredTypes?.set("result", "filename");
  lines.push("  " + (needsDecl ? "let " + targetVar + " =" : targetVar + " =") + " { su: { name: \"result\" }, ob: { filename: __pyaResolvedDest }, be: \"copy\", mood: \"ya\" };");
  lines.push("  globalThis.result = " + targetVar + ";");
  lines.push("}");
  return lines.join("\n");
}
