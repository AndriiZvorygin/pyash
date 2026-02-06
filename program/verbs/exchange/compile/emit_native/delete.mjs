import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

export function handleNativeDelete(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, cHelpers, jsHelpers } = context;
  const { sanitizeName, inlineSentenceLiteral } = helpers;
  if (baseBe !== "delete") return null;
  const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!targetExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: delete target missing",
      from: { name: "compile" },
      raw: { sentence }
    });
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
    const lines = [];
    lines.push("{");
    lines.push(`  const char *__pyaTarget = ${targetExpr};`);
    lines.push("  if (!__pyaTarget || !*__pyaTarget) { fprintf(stderr, \"delete target missing\\n\"); exit(1); }");
    lines.push("  struct stat __pyaStat;");
    lines.push("  if (stat(__pyaTarget, &__pyaStat) != 0) { fprintf(stderr, \"delete target missing\\n\"); exit(1); }");
    lines.push("  if (S_ISDIR(__pyaStat.st_mode)) {");
    if (isFileMode) {
      lines.push("    fprintf(stderr, \"delete target defective\\n\"); exit(1);");
    } else if (isRecursive) {
      lines.push("    if (!pya_fs_delete_recursive(__pyaTarget)) { fprintf(stderr, \"delete defective\\n\"); exit(1); }");
    } else {
      lines.push("    if (rmdir(__pyaTarget) != 0) { fprintf(stderr, \"delete defective\\n\"); exit(1); }");
    }
    lines.push("  } else {");
    if (isDirMode) {
      lines.push("    fprintf(stderr, \"delete target defective\\n\"); exit(1);");
    } else {
      lines.push("    if (unlink(__pyaTarget) != 0) { fprintf(stderr, \"delete defective\\n\"); exit(1); }");
    }
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
  const lines = [];
  lines.push("{");
  lines.push(`  const __pyaTarget = ${targetExpr};`);
  lines.push("  if (!__pyaTarget) throw new Error(\"delete target missing\");");
  lines.push("  const __pyaResolvedInfo = pyaResolveAgentPath(__pyaTarget);");
  lines.push("  if (__pyaResolvedInfo.outside) {");
  lines.push("    throw new Error(`delete defective: outside agent cwd (${__pyaResolvedInfo.agentCwd})`);");
  lines.push("  }");
  lines.push("  const __pyaResolved = __pyaResolvedInfo.resolved;");
  lines.push("  const __pyaStat = fs.statSync(__pyaResolved);");
  lines.push("  if (__pyaStat.isDirectory()) {");
  if (isFileMode) {
    lines.push("    throw new Error(\"delete target defective\");");
  } else if (isRecursive) {
    lines.push("    fs.rmSync(__pyaResolved, { recursive: true, force: false });");
  } else {
    lines.push("    fs.rmdirSync(__pyaResolved);");
  }
  lines.push("  } else {");
  if (isDirMode) {
    lines.push("    throw new Error(\"delete target defective\");");
  } else {
    lines.push("    fs.unlinkSync(__pyaResolved);");
  }
  lines.push("  }");
  lines.push("}");
  return lines.join("\n");
}
