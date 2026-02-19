import { throwErrorSentence } from "../../../../error.mjs";

export function handleNativeInterpret(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, rememberFlag } = context;
  const { sanitizeName, markDeclared } = helpers;
  if (baseBe !== "interpret") return null;
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
      cHelpers.usesToolCapture = true;
      cHelpers.usesSysStat = true;
      cHelpers.usesMapGlobals = true;
    }
    const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar) && !declared?.has(targetName);
    const lines = [];
    if (needsDecl) {
      lines.push(`char ${targetVar}[PYA_TEXT_CAP] = \"\";`);
      markDeclared(declared, targetName);
    }
    if (declaredTypes) declaredTypes.set(targetName, "text");
    lines.push("{");
    lines.push(`  const char *__pyaLang = ${JSON.stringify(String(language ?? "").trim().toLowerCase())};`);
    lines.push(`  if (strcmp(__pyaLang, \"javascript\") != 0) { fprintf(stderr, \"interpret defective: unsupported language %s\\n\", __pyaLang); exit(1); }`);
    lines.push(`  char __pyaTempDir[] = \"/tmp/pyash-interpret-XXXXXX\";`);
    lines.push("  if (!mkdtemp(__pyaTempDir)) { fprintf(stderr, \"interpret defective: temp dir failed\\n\"); exit(1); }");
    lines.push("  char __pyaCwd[PYA_TEXT_CAP];");
    lines.push("  if (!getcwd(__pyaCwd, sizeof(__pyaCwd))) { fprintf(stderr, \"interpret defective: cwd failed\\n\"); exit(1); }");
    lines.push("  char __pyaWasmtime[PYA_TEXT_CAP];");
    lines.push("  char __pyaQuickjs[PYA_TEXT_CAP];");
    lines.push("  const char *__pyaCacheDir = \"/tmp/pyash-wasmtime-cache\";");
    lines.push("  const char *__pyaHome = \"/tmp\";");
    lines.push("  mkdir(__pyaCacheDir, 0700);");
    lines.push("  snprintf(__pyaWasmtime, sizeof(__pyaWasmtime), \"%s/caterer/wasmtime/bin/wasmtime\", __pyaCwd);");
    lines.push("  snprintf(__pyaQuickjs, sizeof(__pyaQuickjs), \"%s/caterer/quickjs-wasi/qjs.wasm\", __pyaCwd);");
    lines.push("  char __pyaScriptPath[PYA_TEXT_CAP];");
    lines.push(`  snprintf(__pyaScriptPath, sizeof(__pyaScriptPath), \"%s/script.js\", __pyaTempDir);`);
    lines.push("  const char *__pyaScript = (pya_ob_text && pya_ob_text[0]) ? pya_ob_text : " + JSON.stringify(scriptText) + ";");
    lines.push("  FILE *__pyaScriptFile = fopen(__pyaScriptPath, \"w\");");
    lines.push("  if (!__pyaScriptFile) { fprintf(stderr, \"interpret defective: script write failed\\n\"); exit(1); }");
    lines.push("  fputs(__pyaScript, __pyaScriptFile);");
    lines.push("  fclose(__pyaScriptFile);");
    lines.push("  char __pyaCmd[PYA_TEXT_CAP];");
    lines.push("  snprintf(__pyaCmd, sizeof(__pyaCmd), \"WASMTIME_CACHE_DIR=\\\"%s\\\" XDG_CACHE_HOME=\\\"%s\\\" HOME=\\\"%s\\\" \\\"%s\\\" run --dir \\\"%s\\\" \\\"%s\\\" -- \\\"%s\\\"\", __pyaCacheDir, __pyaCacheDir, __pyaHome, __pyaWasmtime, __pyaTempDir, __pyaQuickjs, __pyaScriptPath);");
    lines.push("  char *__pyaOut = pya_command(__pyaCmd);");
    lines.push("  remove(__pyaScriptPath);");
    lines.push("  rmdir(__pyaTempDir);");
    lines.push("  if (!__pyaOut) { fprintf(stderr, \"interpret defective\\n\"); exit(1); }");
    lines.push(`  snprintf(${targetVar}, sizeof(${targetVar}), \"%s\", __pyaOut);`);
    lines.push("  if (pya_tool_capture) {");
    lines.push("    snprintf(pya_tool_output, sizeof(pya_tool_output), \"%s\", __pyaOut);");
    lines.push("  }");
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
  lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: String(__pyaOut ?? \"\") }, be: \"interpret\", mood: \"ya\" };`);
  lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
  lines.push(`  globalThis.result = { ...${targetVar}, su: { name: \"result\" } };`);
  lines.push("}");
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "text");
  return lines.join("\n");
}
