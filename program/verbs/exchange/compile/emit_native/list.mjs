import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

export function handleNativeList(context, helpers) {
  const { sentence, baseBe, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, rememberFlag } = context;
  const { sanitizeName, markDeclared, inlineSentenceLiteral } = helpers;
  if (baseBe !== "list") return null;
  const targetName = sentence.su?.name ?? "result";
  const targetVar = sanitizeName(targetName);
  const rootExpr = resolveFilenameLiteral(sentence.from, { lang, declared, locals, sanitizeName, inlineSentenceLiteral }) ?? (lang === "c" ? "\".\"" : "\".\"");
  const hiddenToken = sentence.with?.name ?? sentence.with?.text ?? sentence.with?.wo;
  const hidden = hiddenToken === "hidden";
  const mode = sentence.as?.wo;
  const recursive = mode === "recursive";
  const filter = recursive ? "all" : (mode === "file" || mode === "files" ? "file" : (mode === "dir" || mode === "dirs" || mode === "directory" ? "dir" : "all"));
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
      cHelpers.usesVectorType = true;
      cHelpers.usesVectorPrinter = true;
      cHelpers.usesListPrinter = true;
    }
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar) && !declared?.has(targetName);
    const lines = [];
    if (needsDecl) {
      lines.push(`pya_vec ${targetVar};`);
      markDeclared(declared, targetName);
    }
    if (declaredTypes) declaredTypes.set(targetName, "list");
    lines.push("{");
    lines.push("  pya_str_list __pyaEntries;");
    lines.push("  pya_list_init(&__pyaEntries);");
    lines.push(`  const char *__pyaRoot = ${rootExpr};`);
    lines.push("  struct stat __pyaStat;");
    lines.push("  if (!__pyaRoot || !*__pyaRoot || stat(__pyaRoot, &__pyaStat) != 0 || !S_ISDIR(__pyaStat.st_mode)) {");
    lines.push("    fprintf(stderr, \"list defective\\n\");");
    lines.push("    exit(1);");
    lines.push("  }");
    const includeFiles = filter === "file" || filter === "all";
    const includeDirs = filter === "dir" || filter === "all";
    lines.push(`  if (!pya_list_walk(__pyaRoot, \"\", ${recursive ? 1 : 0}, ${includeFiles ? 1 : 0}, ${includeDirs ? 1 : 0}, ${hidden ? 1 : 0}, &__pyaEntries)) { fprintf(stderr, \"list defective\\n\"); exit(1); }`);
    lines.push("  pya_list_sort(&__pyaEntries);");
    lines.push("  const char *__pyaVecType = (__pyaEntries.length > 0) ? \"text\" : \"hollow\";");
    lines.push(`  ${targetVar} = (pya_vec){ __pyaVecType, __pyaEntries.length, NULL, (const char **)__pyaEntries.items };`);
    lines.push("}");
    return lines.join("\n");
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
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
  lines.push("  const __pyaEntries = [];");
  lines.push(`  const __pyaRoot = ${rootExpr} || \".\";`);
  lines.push(`  const __pyaHidden = ${hidden ? "true" : "false"};`);
  lines.push(`  const __pyaRecursive = ${recursive ? "true" : "false"};`);
  lines.push(`  const __pyaFilter = ${JSON.stringify(filter)};`);
  lines.push("  const __pyaIncludeFiles = (__pyaFilter === \"file\" || __pyaFilter === \"all\");");
  lines.push("  const __pyaIncludeDirs = (__pyaFilter === \"dir\" || __pyaFilter === \"all\");");
  lines.push("  const __pyaRootPath = path.resolve(String(__pyaRoot));");
  lines.push("  const __pyaStat = fs.statSync(__pyaRootPath);");
  lines.push("  if (!__pyaStat.isDirectory()) throw new Error(`list defective: ${__pyaRootPath}`);");
  lines.push("  const __pyaNormalizePath = (value) => value.split(path.sep).join(\"/\");");
  lines.push("  const __pyaWalk = (current, relBase) => {");
  lines.push("    const dirents = fs.readdirSync(current, { withFileTypes: true });");
  lines.push("    for (const dirent of dirents) {");
  lines.push("      if (!__pyaHidden && dirent.name.startsWith(\".\")) continue;");
  lines.push("      const fullPath = path.join(current, dirent.name);");
  lines.push("      const relPath = relBase ? path.join(relBase, dirent.name) : dirent.name;");
  lines.push("      const outputPath = __pyaRecursive ? __pyaNormalizePath(relPath) : dirent.name;");
  lines.push("      if (dirent.isDirectory()) {");
  lines.push("        if (__pyaIncludeDirs) __pyaEntries.push(outputPath);");
  lines.push("        if (__pyaRecursive) __pyaWalk(fullPath, relPath);");
  lines.push("      } else {");
  lines.push("        if (__pyaIncludeFiles) __pyaEntries.push(outputPath);");
  lines.push("      }");
  lines.push("    }");
  lines.push("  };");
  lines.push("  __pyaWalk(__pyaRootPath, \"\");");
  lines.push("  __pyaEntries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));");
  lines.push("  const __pyaVec = __pyaEntries.length ? { type: \"text\", values: __pyaEntries } : { type: \"hollow\", values: [] };");
  lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: __pyaVec }, be: \"list\", mood: \"ya\" };`);
  lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
  lines.push(`  globalThis.result = { ...${targetVar}, su: { name: \"result\" } };`);
  lines.push("}");
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "list");
  return lines.join("\n");
}
