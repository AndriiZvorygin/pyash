import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

export function handleNativeDirectory(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, cHelpers, jsHelpers } = context;
  const { sanitizeName, inlineSentenceLiteral } = helpers;
  if (baseBe !== "directory") return null;
  const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!targetExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: directory target missing",
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
    const lines = [];
    lines.push("{");
    lines.push(`  const char *__pyaTarget = ${targetExpr};`);
    lines.push("  if (!__pyaTarget || !*__pyaTarget) { fprintf(stderr, \"directory target missing\\n\"); exit(1); }");
    lines.push("  if (!pya_fs_mkdir_recursive(__pyaTarget)) { fprintf(stderr, \"directory defective\\n\"); exit(1); }");
    lines.push("  struct stat __pyaStat;");
    lines.push("  if (stat(__pyaTarget, &__pyaStat) != 0 || !S_ISDIR(__pyaStat.st_mode)) { fprintf(stderr, \"directory defective\\n\"); exit(1); }");
    lines.push("}");
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
    jsHelpers.usesResolveFilename = true;
  }
  const lines = [];
  lines.push("{");
  lines.push(`  const __pyaTarget = ${targetExpr};`);
  lines.push("  if (!__pyaTarget) throw new Error(\"directory target missing\");");
  lines.push("  const __pyaResolved = path.resolve(String(__pyaTarget));");
  lines.push("  fs.mkdirSync(__pyaResolved, { recursive: true });");
  lines.push("  const __pyaStat = fs.statSync(__pyaResolved);");
  lines.push("  if (!__pyaStat.isDirectory()) throw new Error(\"directory defective\");");
  lines.push("}");
  return lines.join("\n");
}
