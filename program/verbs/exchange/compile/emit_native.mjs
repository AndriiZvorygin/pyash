import { throwErrorSentence } from "../../../error.mjs";

function nextTemp(prefix, cState) {
  const next = (cState.tempCounter ?? 0) + 1;
  cState.tempCounter = next;
  return `__pya_${prefix}_${next}`;
}

function resolveFilenameLiteral(slot, { lang, declared, locals, sanitizeName, inlineSentenceLiteral } = {}) {
  if (!slot) return null;
  if (typeof slot.filename === "string") return JSON.stringify(slot.filename);
  if (typeof slot.text === "string") return JSON.stringify(slot.text);
  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (lang === "c") {
      if (locals?.has(name) || declared?.has(name) || declared?.has(slot.name)) return name;
      return null;
    }
    const literal = inlineSentenceLiteral(slot, declared);
    return `pyaResolveFilename(${literal})`;
  }
  if (lang !== "c") {
    const literal = inlineSentenceLiteral(slot, declared);
    return `pyaResolveFilename(${literal})`;
  }
  return null;
}

function boolExprForClause(clause, context, helpers) {
  if (!clause || typeof clause !== "object") {
    throwErrorSentence({
      name: "compile error",
      message: "compile: boolean clause missing",
      from: { name: "compile" },
      raw: { clause }
    });
  }
  const clauseBe = clause.be;
  const baseBe = clauseBe ? String(clauseBe).toLowerCase() : "";
  if (baseBe === "exists") {
    const targetExpr = resolveFilenameLiteral(clause.ob, {
      lang: context.lang,
      declared: context.declared,
      locals: context.locals,
      sanitizeName: helpers.sanitizeName,
      inlineSentenceLiteral: helpers.inlineSentenceLiteral
    });
    if (!targetExpr) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: exists target missing",
        from: { name: "compile" },
        raw: { clause }
      });
    }
    if (context.lang === "c") {
      const temp = nextTemp("exists", context.cState);
      const lines = [];
      lines.push(`int ${temp} = 0;`);
      lines.push(`{ struct stat st; ${temp} = (stat(${targetExpr}, &st) == 0); }`);
      return { lines, valueVar: temp };
    }
    const expr = `(() => { const __pyaTarget = ${targetExpr}; if (!__pyaTarget) throw new Error("exists target missing"); return fs.existsSync(String(__pyaTarget)); })()`;
    return { lines: [], valueExpr: expr };
  }
  if (baseBe === "not") {
    if (context.lang === "c") {
      const inner = boolExprForClause(clause.ob?.la, context, helpers);
      const temp = nextTemp("not", context.cState);
      const lines = [];
      if (inner.lines?.length) lines.push(...inner.lines);
      lines.push(`int ${temp} = !(${inner.valueVar});`);
      return { lines, valueVar: temp };
    }
    const inner = boolExprForClause(clause.ob?.la, context, helpers);
    return { lines: [], valueExpr: `(!(${inner.valueExpr}))` };
  }
  if (baseBe === "and" || baseBe === "or") {
    const left = boolExprForClause(clause.ob?.la, context, helpers);
    const right = boolExprForClause(clause.with?.la, context, helpers);
    if (context.lang === "c") {
      const temp = nextTemp(baseBe, context.cState);
      const lines = [];
      if (left.lines?.length) lines.push(...left.lines);
      lines.push(`int ${temp} = 0;`);
      if (baseBe === "and") {
        lines.push(`if (${left.valueVar}) {`);
        if (right.lines?.length) lines.push(...right.lines.map(l => `  ${l}`));
        lines.push(`  ${temp} = ${right.valueVar};`);
        lines.push("} else {");
        lines.push(`  ${temp} = 0;`);
        lines.push("}");
      } else {
        lines.push(`if (${left.valueVar}) {`);
        lines.push(`  ${temp} = 1;`);
        lines.push("} else {");
        if (right.lines?.length) lines.push(...right.lines.map(l => `  ${l}`));
        lines.push(`  ${temp} = ${right.valueVar};`);
        lines.push("}");
      }
      return { lines, valueVar: temp };
    }
    const op = baseBe === "and" ? "&&" : "||";
    return { lines: [], valueExpr: `(${left.valueExpr} ${op} ${right.valueExpr})` };
  }
  throwErrorSentence({
    name: "compile error",
    message: "compile: boolean clause unsupported",
    from: { name: "compile" },
    raw: { clause }
  });
}

export function handleNativeSentence(context, helpers) {
  const {
    sentence,
    baseBe,
    ob,
    lang,
    locals,
    declared,
    declaredTypes,
    cHelpers,
    jsHelpers,
    cState,
    rememberFlag
  } = context;
  const {
    sanitizeName,
    markDeclared,
    inlineSentenceLiteral
  } = helpers;

  if (baseBe === "exists") {
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
        lines.push(`char ${targetVar}[PYA_TEXT_CAP] = "";`);
        markDeclared(declared, targetName);
      }
      if (declaredTypes) declaredTypes.set(targetName, "text");
      lines.push(`{ struct stat st; int __pyaExists = (stat(${targetExpr}, &st) == 0); snprintf(${targetVar}, sizeof(${targetVar}), "%s", __pyaExists ? "truth" : "lie"); }`);
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
    lines.push(`  const __pyaExists = (() => { const __pyaTarget = ${targetExpr}; if (!__pyaTarget) throw new Error("exists target missing"); return fs.existsSync(String(__pyaTarget)); })();`);
    lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { boolean: __pyaExists, text: (__pyaExists ? "truth" : "lie") }, be: "exists", mood: "ya" };`);
    lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
    lines.push(`  globalThis.result = { ...${targetVar}, su: { name: "result" } };`);
    lines.push("}");
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    return lines.join("\n");
  }

  if (baseBe === "and" || baseBe === "or" || baseBe === "not") {
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
        lines.push(`char ${targetVar}[PYA_TEXT_CAP] = "";`);
        markDeclared(declared, targetName);
      }
      if (declaredTypes) declaredTypes.set(targetName, "text");
      lines.push(`snprintf(${targetVar}, sizeof(${targetVar}), "%s", ${clause.valueVar} ? "truth" : "lie");`);
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
    lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { boolean: __pyaBool, text: (__pyaBool ? "truth" : "lie") }, be: ${JSON.stringify(baseBe)}, mood: "ya" };`);
    lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
    lines.push(`  globalThis.result = { ...${targetVar}, su: { name: "result" } };`);
    lines.push("}");
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    return lines.join("\n");
  }

  if (baseBe === "interpret") {
    const scriptText = ob?.text;
    const language = sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? "";
    const timeoutRaw = sentence?.during?.num ?? sentence?.during?.text ?? sentence?.during?.name;
    const timeoutValue = typeof timeoutRaw === "number" ? timeoutRaw : Number(timeoutRaw);
    const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0
      ? Math.max(1, Math.trunc(timeoutValue * 1000))
      : 500;
    if (typeof scriptText !== "string") {
      throwErrorSentence({
        name: "compile error",
        message: "compile: interpret script missing",
        from: { name: "compile" },
        raw: { sentence }
      });
    }
    const targetName = sentence.su?.name ?? "result";
    const targetVar = sanitizeName(targetName);
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesCommand = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
      }
      const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar) && !declared?.has(targetName);
      const lines = [];
      if (needsDecl) {
        lines.push(`char ${targetVar}[PYA_TEXT_CAP] = "";`);
        markDeclared(declared, targetName);
      }
      if (declaredTypes) declaredTypes.set(targetName, "text");
      lines.push("{");
      lines.push(`  const char *__pyaLang = ${JSON.stringify(String(language ?? "").trim().toLowerCase())};`);
      lines.push(`  if (strcmp(__pyaLang, "javascript") != 0) { fprintf(stderr, "interpret defective: unsupported language %s\\n", __pyaLang); exit(1); }`);
      lines.push(`  char __pyaTempDir[] = "/tmp/pyash-interpret-XXXXXX";`);
      lines.push("  if (!mkdtemp(__pyaTempDir)) { fprintf(stderr, \"interpret defective: temp dir failed\\n\"); exit(1); }");
      lines.push("  char __pyaCwd[PYA_TEXT_CAP];");
      lines.push("  if (!getcwd(__pyaCwd, sizeof(__pyaCwd))) { fprintf(stderr, \"interpret defective: cwd failed\\n\"); exit(1); }");
      lines.push("  char __pyaWasmtime[PYA_TEXT_CAP];");
      lines.push("  char __pyaQuickjs[PYA_TEXT_CAP];");
      lines.push("  snprintf(__pyaWasmtime, sizeof(__pyaWasmtime), \"%s/caterer/wasmtime/bin/wasmtime\", __pyaCwd);");
      lines.push("  snprintf(__pyaQuickjs, sizeof(__pyaQuickjs), \"%s/caterer/quickjs-wasi/qjs.wasm\", __pyaCwd);");
      lines.push("  char __pyaScriptPath[PYA_TEXT_CAP];");
      lines.push(`  snprintf(__pyaScriptPath, sizeof(__pyaScriptPath), "%s/script.js", __pyaTempDir);`);
      lines.push("  FILE *__pyaScriptFile = fopen(__pyaScriptPath, \"w\");");
      lines.push("  if (!__pyaScriptFile) { fprintf(stderr, \"interpret defective: script write failed\\n\"); exit(1); }");
      lines.push(`  fputs(${JSON.stringify(scriptText)}, __pyaScriptFile);`);
      lines.push("  fclose(__pyaScriptFile);");
      lines.push("  char __pyaCmd[PYA_TEXT_CAP];");
      lines.push("  snprintf(__pyaCmd, sizeof(__pyaCmd), \"\\\"%s\\\" run --dir \\\"%s\\\" \\\"%s\\\" -- \\\"%s\\\"\", __pyaWasmtime, __pyaTempDir, __pyaQuickjs, __pyaScriptPath);");
      lines.push("  char *__pyaOut = pya_command(__pyaCmd);");
      lines.push("  remove(__pyaScriptPath);");
      lines.push("  rmdir(__pyaTempDir);");
      lines.push("  if (!__pyaOut) { fprintf(stderr, \"interpret defective\\n\"); exit(1); }");
      lines.push(`  snprintf(${targetVar}, sizeof(${targetVar}), "%s", __pyaOut);`);
      lines.push("  free(__pyaOut);");
      lines.push("}");
      return lines.join("\n");
    }
    if (jsHelpers) {
      jsHelpers.usesInterpret = true;
      jsHelpers.usesFs = true;
      jsHelpers.usesCommand = true;
      jsHelpers.usesPath = true;
      jsHelpers.usesOs = true;
    }
    if (rememberFlag) rememberFlag.used = true;
    const needsDecl = !declared?.has(targetName) && !declared?.has(targetVar);
    const lines = [];
    if (needsDecl) {
      lines.push(`let ${targetVar};`);
    }
    lines.push("{");
    lines.push(`  const __pyaLang = ${JSON.stringify(String(language ?? "").trim().toLowerCase())};`);
    lines.push("  if (__pyaLang !== \"javascript\") { throw new Error(`interpret defective: unsupported language ${__pyaLang}`); }");
    lines.push(`  const __pyaTimeout = ${timeoutMs};`);
    lines.push(`  const __pyaOut = pyaInterpret(${JSON.stringify(scriptText)}, __pyaTimeout);`);
    lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: String(__pyaOut ?? "") }, be: "interpret", mood: "ya" };`);
    lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
    lines.push(`  globalThis.result = { ...${targetVar}, su: { name: "result" } };`);
    lines.push("}");
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    return lines.join("\n");
  }

  if (baseBe === "list") {
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
      lines.push(`  if (!pya_list_walk(__pyaRoot, "", ${recursive ? 1 : 0}, ${includeFiles ? 1 : 0}, ${includeDirs ? 1 : 0}, ${hidden ? 1 : 0}, &__pyaEntries)) { fprintf(stderr, "list defective\\n"); exit(1); }`);
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
    lines.push(`  const __pyaRoot = ${rootExpr} || ".";`);
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
    lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { ve: __pyaVec }, be: "list", mood: "ya" };`);
    lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
    lines.push(`  globalThis.result = { ...${targetVar}, su: { name: "result" } };`);
    lines.push("}");
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "list");
    return lines.join("\n");
  }

  if (baseBe === "ecology") {
    const targetName = sentence.su?.name;
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesStdlib = true;
      }
      if (!targetName && sentence.ob === undefined) return null;
      if (!targetName) {
        throwErrorSentence({
          name: "compile error",
          message: "compile: ecology target missing",
          from: { name: "compile" },
          raw: { sentence }
        });
      }
      const targetVar = sanitizeName(targetName);
      const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar) && !declared?.has(targetName);
      const valueExpr = (() => {
        if (!sentence.ob) return null;
        if (typeof sentence.ob.text === "string") return JSON.stringify(sentence.ob.text);
        if (typeof sentence.ob.num === "number") return JSON.stringify(String(sentence.ob.num));
        if (typeof sentence.ob.boolean === "boolean") return JSON.stringify(sentence.ob.boolean ? "truth" : "lie");
        if (sentence.ob.hollow) return JSON.stringify("");
        if (sentence.ob.name) {
          const nameVar = sanitizeName(sentence.ob.name);
          if (locals?.has(nameVar) || declared?.has(nameVar) || declared?.has(sentence.ob.name)) return nameVar;
        }
        return null;
      })();
      const lines = [];
      if (valueExpr) {
        lines.push(`setenv(${JSON.stringify(targetName)}, ${valueExpr}, 1);`);
      }
      if (needsDecl) {
        lines.push(`char ${targetVar}[PYA_TEXT_CAP] = "";`);
        markDeclared(declared, targetName);
      }
      if (declaredTypes) declaredTypes.set(targetName, "text");
      lines.push("{");
      lines.push(`  const char *__pyaEnv = getenv(${JSON.stringify(targetName)});`);
      lines.push(`  snprintf(${targetVar}, sizeof(${targetVar}), "%s", __pyaEnv ? __pyaEnv : "null");`);
      lines.push("}");
      return lines.join("\n");
    }
    if (jsHelpers) {
      jsHelpers.usesResolveFilename = true;
      jsHelpers.usesBoolHelper = true;
    }
    if (rememberFlag) rememberFlag.used = true;
    if (!targetName && sentence.ob === undefined) {
      if (jsHelpers) jsHelpers.usesVectorFormat = true;
      const mapName = "ecology env";
      markDeclared(declared, mapName);
      if (declaredTypes) declaredTypes.set(mapName, "map");
      return [
        "{",
        `  const __pyaEnvEntries = Object.entries(process.env).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));`,
        `  const __pyaEnvMap = {};`,
        `  for (const [key, value] of __pyaEnvEntries) { __pyaEnvMap[key] = { text: String(value ?? \"\") }; }`,
        `  const __pyaEnvFact = { su: { name: ${JSON.stringify(mapName)} }, be: "map", ob: { map: __pyaEnvMap }, mood: "ya" };`,
        `  globalThis[${JSON.stringify(mapName)}] = __pyaEnvFact;`,
        `  const __pyaEnvResult = { su: { name: "ecology" }, be: "ecology", ob: { name: ${JSON.stringify(mapName)} }, mood: "ya" };`,
        `  globalThis.result = { ...__pyaEnvResult, su: { name: "result" } };`,
        "}"
      ].join("\n");
    }
    if (!targetName) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: ecology target missing",
        from: { name: "compile" },
        raw: { sentence }
      });
    }
    const targetVar = sanitizeName(targetName);
    const valueExpr = (() => {
      if (!sentence.ob) return null;
      if (typeof sentence.ob.text === "string") return JSON.stringify(sentence.ob.text);
      if (typeof sentence.ob.num === "number") return JSON.stringify(String(sentence.ob.num));
      if (typeof sentence.ob.boolean === "boolean") return JSON.stringify(sentence.ob.boolean ? "truth" : "lie");
      if (sentence.ob.hollow) return JSON.stringify("");
      if (sentence.ob.name) {
        const nameVar = sanitizeName(sentence.ob.name);
        if (locals?.has(nameVar) || declared?.has(nameVar) || declared?.has(sentence.ob.name)) {
          return `${nameVar}.ob?.text ?? ${nameVar}.ob?.num ?? (${nameVar}.ob?.boolean ? "truth" : "lie")`;
        }
        return `pyaResolveFilename(${inlineSentenceLiteral(sentence.ob, declared)})`;
      }
      return null;
    })();
    const needsDecl = !declared?.has(targetName) && !declared?.has(targetVar);
    const lines = [];
    if (needsDecl) {
      lines.push(`let ${targetVar};`);
    }
    lines.push("{");
    if (valueExpr) lines.push(`  process.env[${JSON.stringify(targetName)}] = ${valueExpr};`);
    lines.push(`  const __pyaCurrent = process.env[${JSON.stringify(targetName)}];`);
    lines.push("  const __pyaMissing = (__pyaCurrent === undefined);");
    lines.push("  const __pyaValue = __pyaMissing ? \"null\" : String(__pyaCurrent);");
    lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: __pyaValue, hollow: __pyaMissing }, be: "ecology", mood: "ya" };`);
    lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
    lines.push(`  globalThis.result = { ...${targetVar}, su: { name: "result" } };`);
    lines.push("}");
    markDeclared(declared, targetName);
    if (declaredTypes) declaredTypes.set(targetName, "text");
    return lines.join("\n");
  }

  if (baseBe === "license") {
    const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
    if (!targetExpr) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: license target missing",
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
        cHelpers.usesCommand = true;
      }
      const modeNum = sentence.as?.num;
      if (typeof modeNum === "number") {
        const raw = String(modeNum);
        const mode = /^[0-7]+$/.test(raw) ? parseInt(raw, 8) : modeNum;
        return `if (chmod(${targetExpr}, ${Math.trunc(mode)}) != 0) { fprintf(stderr, "license defective\\n"); exit(1); }`;
      }
      const modeText = sentence.as?.text;
      if (typeof modeText === "string" && modeText.trim()) {
        const cmd = JSON.stringify(`chmod ${modeText} `) + " + " + targetExpr;
        return `if (!pya_command(${cmd})) { fprintf(stderr, "license defective\\n"); exit(1); }`;
      }
      const values = sentence.as?.ve?.values;
      if (Array.isArray(values) && values.length > 0) {
        const vecType = sentence.as?.ve?.type;
        const prefix = (typeof vecType === "string" && !["num", "text", "bool", "name", "filename"].includes(vecType))
          ? [vecType]
          : [];
        const merged = [...prefix, ...values].map((v) => String(v ?? ""));
        let groups = { owner: null, flock: null, all: null };
        let current = null;
        for (const token of merged) {
          if (token === "owner" || token === "flock" || token === "all") {
            current = token;
            groups[current] = [];
            continue;
          }
          if (!current) { groups = null; break; }
          groups[current].push(token);
        }
        const bitsFromTokens = (tokens) => {
          if (!Array.isArray(tokens)) return 0;
          let bits = 0;
          if (tokens.includes("read")) bits |= 4;
          if (tokens.includes("write")) bits |= 2;
          if (tokens.includes("command")) bits |= 1;
          return bits;
        };
        let mode;
        if (groups) {
          const owner = bitsFromTokens(groups.owner);
          const flock = bitsFromTokens(groups.flock);
          const all = bitsFromTokens(groups.all);
          mode = (owner << 6) | (flock << 3) | all;
        } else {
          const scope = sentence.for?.name ?? sentence.for?.text;
          const bits = bitsFromTokens(merged);
          if (scope === "owner") mode = bits << 6;
          else if (scope === "flock") mode = bits << 3;
          else if (scope === "all") mode = bits;
        }
        if (mode === undefined) {
          throwErrorSentence({
            name: "compile error",
            message: "compile: license vector defective",
            from: { name: "compile" },
            raw: { sentence }
          });
        }
        return `if (chmod(${targetExpr}, ${Math.trunc(mode)}) != 0) { fprintf(stderr, "license defective\\n"); exit(1); }`;
      }
      throwErrorSentence({
        name: "compile error",
        message: "compile: license defective",
        from: { name: "compile" },
        raw: { sentence }
      });
    }
    if (jsHelpers) {
      jsHelpers.usesFs = true;
      jsHelpers.usesPath = true;
      jsHelpers.usesCommand = true;
      jsHelpers.usesResolveFilename = true;
    }
    if (rememberFlag) rememberFlag.used = true;
    const modeNum = sentence.as?.num;
    if (typeof modeNum === "number") {
      const raw = String(modeNum);
      const mode = /^[0-7]+$/.test(raw) ? parseInt(raw, 8) : modeNum;
      return `fs.chmodSync(String(${targetExpr}), ${Math.trunc(mode)});`;
    }
    const modeText = sentence.as?.text;
    if (typeof modeText === "string" && modeText.trim()) {
      return `child_process.execFileSync("chmod", [${JSON.stringify(modeText)}, String(${targetExpr})]);`;
    }
    const values = sentence.as?.ve?.values;
    if (Array.isArray(values) && values.length > 0) {
      const vecType = sentence.as?.ve?.type;
      const prefix = (typeof vecType === "string" && !["num", "text", "bool", "name", "filename"].includes(vecType))
        ? [vecType]
        : [];
      const merged = [...prefix, ...values].map((v) => String(v ?? ""));
      let groups = { owner: null, flock: null, all: null };
      let current = null;
      for (const token of merged) {
        if (token === "owner" || token === "flock" || token === "all") {
          current = token;
          groups[current] = [];
          continue;
        }
        if (!current) { groups = null; break; }
        groups[current].push(token);
      }
      const bitsFromTokens = (tokens) => {
        if (!Array.isArray(tokens)) return 0;
        let bits = 0;
        if (tokens.includes("read")) bits |= 4;
        if (tokens.includes("write")) bits |= 2;
        if (tokens.includes("command")) bits |= 1;
        return bits;
      };
      let mode;
      if (groups) {
        const owner = bitsFromTokens(groups.owner);
        const flock = bitsFromTokens(groups.flock);
        const all = bitsFromTokens(groups.all);
        mode = (owner << 6) | (flock << 3) | all;
      } else {
        const scope = sentence.for?.name ?? sentence.for?.text;
        const bits = bitsFromTokens(merged);
        if (scope === "owner") mode = bits << 6;
        else if (scope === "flock") mode = bits << 3;
        else if (scope === "all") mode = bits;
      }
      if (mode === undefined) {
        throwErrorSentence({
          name: "compile error",
          message: "compile: license vector defective",
          from: { name: "compile" },
          raw: { sentence }
        });
      }
      return `fs.chmodSync(String(${targetExpr}), ${Math.trunc(mode)});`;
    }
    throwErrorSentence({
      name: "compile error",
      message: "compile: license defective",
      from: { name: "compile" },
      raw: { sentence }
    });
  }

  if (baseBe === "copy") {
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
      lines.push(`  if (stat(${srcExpr}, &__pyaStat) != 0) { fprintf(stderr, "copy source missing\\n"); exit(1); }`);
      if (recursive) {
        lines.push(`  if (!S_ISDIR(__pyaStat.st_mode)) { fprintf(stderr, "copy source defective\\n"); exit(1); }`);
        lines.push(`  if (!pya_fs_copy_dir(${srcExpr}, ${destExpr})) { fprintf(stderr, "copy defective\\n"); exit(1); }`);
      } else {
        lines.push(`  if (!S_ISREG(__pyaStat.st_mode)) { fprintf(stderr, "copy source defective\\n"); exit(1); }`);
        lines.push("  char __pyaDestDir[PYA_TEXT_CAP];");
        lines.push(`  snprintf(__pyaDestDir, sizeof(__pyaDestDir), "%s", ${destExpr});`);
        lines.push("  char *__pyaSlash = strrchr(__pyaDestDir, '/');");
        lines.push("  if (__pyaSlash) { *__pyaSlash = '\\0'; if (!pya_fs_mkdir_recursive(__pyaDestDir)) { fprintf(stderr, \"copy defective\\n\"); exit(1); } }");
        lines.push(`  if (!pya_fs_copy_file(${srcExpr}, ${destExpr})) { fprintf(stderr, "copy defective\\n"); exit(1); }`);
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
      lines.push(`  if (!__pyaStat.isDirectory()) throw new Error("copy source defective");`);
      lines.push(`  if (typeof fs.cpSync !== "function") throw new Error("copy defective: recursive copy unsupported");`);
      lines.push(`  fs.cpSync(__pyaSrc, __pyaDest, { recursive: true, force: true });`);
    } else {
      lines.push(`  if (!__pyaStat.isFile()) throw new Error("copy source defective");`);
      lines.push(`  fs.mkdirSync(path.dirname(__pyaDest), { recursive: true });`);
      lines.push(`  fs.copyFileSync(__pyaSrc, __pyaDest);`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  return null;
}
