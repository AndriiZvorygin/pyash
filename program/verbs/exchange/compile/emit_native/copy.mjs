import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

export function handleNativeCopy(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, cHelpers, jsHelpers, rememberFlag } = context;
  const { sanitizeName, inlineSentenceLiteral } = helpers;
  if (baseBe !== "copy") return null;
  const srcExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  const destExpr = resolveFilenameLiteral(sentence.to, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!srcExpr || !destExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: copy target missing",
      from: { name: "compile" },
      raw: { sentence }
    });
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
    const lines = [];
    lines.push("{");
    lines.push(`  struct stat __pyaStat;`);
    lines.push(`  if (stat(${srcExpr}, &__pyaStat) != 0) { fprintf(stderr, \"copy source missing\\n\"); exit(1); }`);
    if (recursive) {
      lines.push(`  if (!S_ISDIR(__pyaStat.st_mode)) { fprintf(stderr, \"copy source defective\\n\"); exit(1); }`);
      lines.push(`  if (!pya_fs_copy_dir(${srcExpr}, ${destExpr})) { fprintf(stderr, \"copy defective\\n\"); exit(1); }`);
    } else {
      lines.push(`  if (!S_ISREG(__pyaStat.st_mode)) { fprintf(stderr, \"copy source defective\\n\"); exit(1); }`);
      lines.push("  char __pyaDestDir[PYA_TEXT_CAP];");
      lines.push(`  snprintf(__pyaDestDir, sizeof(__pyaDestDir), \"%s\", ${destExpr});`);
      lines.push("  char *__pyaSlash = strrchr(__pyaDestDir, '/');");
      lines.push("  if (__pyaSlash) { *__pyaSlash = '\\0'; if (!pya_fs_mkdir_recursive(__pyaDestDir)) { fprintf(stderr, \"copy defective\\n\"); exit(1); } }");
      lines.push(`  if (!pya_fs_copy_file(${srcExpr}, ${destExpr})) { fprintf(stderr, \"copy defective\\n\"); exit(1); }`);
    }
    lines.push("}");
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
    jsHelpers.usesResolveFilename = true;
  }
  if (rememberFlag) rememberFlag.used = true;
  const lines = [];
  lines.push("{");
  lines.push(`  const __pyaSrc = String(${srcExpr});`);
  lines.push(`  const __pyaDest = String(${destExpr});`);
  lines.push(`  const __pyaStat = fs.statSync(__pyaSrc);`);
  if (recursive) {
    lines.push(`  if (!__pyaStat.isDirectory()) throw new Error(\"copy source defective\");`);
    lines.push(`  if (typeof fs.cpSync !== \"function\") throw new Error(\"copy defective: recursive copy unsupported\");`);
    lines.push(`  fs.cpSync(__pyaSrc, __pyaDest, { recursive: true, force: true });`);
  } else {
    lines.push(`  if (!__pyaStat.isFile()) throw new Error(\"copy source defective\");`);
    lines.push(`  fs.mkdirSync(path.dirname(__pyaDest), { recursive: true });`);
    lines.push(`  fs.copyFileSync(__pyaSrc, __pyaDest);`);
  }
  lines.push("}");
  return lines.join("\n");
}
