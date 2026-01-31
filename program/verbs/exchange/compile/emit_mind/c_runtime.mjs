export function handleMindSentenceC(context, helpers) {
  const {
    sentence,
    ob,
    declaredTypes,
    jsHelpers,
    cHelpers,
    cState,
    mapDefs,
    rememberFlag
  } = context;
  const {
    buildToolSchemasForCompile,
    compareUtf8,
    sanitizeName,
    sentenceToPyash
  } = helpers;

  if (cHelpers) {
    cHelpers.usesMindRuntime = true;
    cHelpers.usesJsonRuntime = true;
    cHelpers.usesTextHelper = true;
    cHelpers.usesString = true;
    cHelpers.usesStdlib = true;
    cHelpers.usesPrintf = true;
    cHelpers.usesCtype = true;
    cHelpers.usesExchange = true;
    cHelpers.usesMap = true;
  }
  const mindName = sentence.for?.name ?? sentence.to?.name ?? ob.to?.name ?? sentence.su?.name ?? "mind";
  if (sentence.mood === "ya") {
    if (declaredTypes) declaredTypes.set(mindName, "mind");
    const space = sentence.from?.name ?? ob.space ?? null;
    const model = sentence.as?.name ?? ob.model ?? null;
    const prompt = sentence.fromtext?.name ?? sentence.fromtext?.text ?? ob.text ?? null;
    const window = sentence.by?.num ?? sentence.by?.quantity?.num ?? sentence.ob?.window?.num ?? ob.window?.num ?? null;
    const lines = [];
    lines.push(`pya_mind_set_config(${JSON.stringify(mindName)}, ${space ? JSON.stringify(space) : "NULL"}, ${model ? JSON.stringify(model) : "NULL"}, ${prompt ? JSON.stringify(prompt) : "NULL"}, ${window ? Number(window) || 8 : 0});`);
    return lines.join("\n");
  }
  const userText = ob.text
    ? JSON.stringify(ob.text)
    : ob.name
      ? JSON.stringify(ob.name)
      : "\"\"";
  const explicitModel = ob.model ? JSON.stringify(ob.model) : "NULL";
  const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
  const dialogue = `${mindName} story`;
  const toolMapName = sentence.with?.name ?? null;
  const toolVar = toolMapName && (declaredTypes?.get(toolMapName) === "map" || declaredTypes?.get(toolMapName) === "json map" || declaredTypes?.get(toolMapName) === "csv map")
    ? sanitizeName(toolMapName)
    : null;
  let toolJsonLiteral = "NULL";
  let toolDispatchName = "NULL";
  if (toolMapName && mapDefs?.has(toolMapName)) {
    const mapSentence = mapDefs.get(toolMapName);
    const toolSchemas = buildToolSchemasForCompile(mapSentence?.ob?.map ?? {});
    if (toolSchemas.tools.length) {
      toolJsonLiteral = JSON.stringify(JSON.stringify(toolSchemas.tools));
      toolDispatchName = "pya_tool_dispatch";
      if (cState) {
        if (cHelpers) cHelpers.usesToolCapture = true;
        cState.preMain = cState.preMain || [];
        const dispatchLines = [];
        dispatchLines.push("static char *pya_tool_dispatch(const char *name, const char *args_json) {");
        dispatchLines.push("  if (!name) return NULL;");
        dispatchLines.push("  cJSON *args = args_json && args_json[0] ? cJSON_Parse(args_json) : cJSON_CreateObject();");
        dispatchLines.push("  static char pya_tool_ob_text[PYA_TEXT_CAP];");
        dispatchLines.push("  pya_ob_text = \"\";");
        dispatchLines.push("  pya_ob_num = 0;");
        dispatchLines.push("  pya_ob_bool = 0;");
        dispatchLines.push("  pya_from_num = 0;");
        for (const tool of toolSchemas.tools) {
          const toolName = tool?.function?.name;
          const signatureName = tool?.function?.signature ?? "";
          const isInterpretTool = signatureName.startsWith("be interpret") || String(toolName ?? "").startsWith("be_interpret");
          if (!toolName) continue;
          const props = tool?.function?.parameters?.properties ?? {};
          dispatchLines.push(`  if (strcmp(name, ${JSON.stringify(toolName)}) == 0) {`);
          if (isInterpretTool && cHelpers) {
            cHelpers.usesCommand = true;
            cHelpers.usesTextHelper = true;
            cHelpers.usesString = true;
            cHelpers.usesStdlib = true;
            cHelpers.usesPrintf = true;
            cHelpers.usesToolCapture = true;
          }
          if (isInterpretTool) {
            dispatchLines.push("    double pya_tool_during = 0;");
            dispatchLines.push("    char pya_tool_as_text[PYA_TEXT_CAP];");
            dispatchLines.push("    pya_tool_as_text[0] = '\\0';");
          }
          if (props.ob) {
            if (props.ob.type === "string") {
              dispatchLines.push("    cJSON *ob = args ? cJSON_GetObjectItemCaseSensitive(args, \"ob\") : NULL;");
              dispatchLines.push("    if (ob && cJSON_IsString(ob)) { snprintf(pya_tool_ob_text, sizeof(pya_tool_ob_text), \"%s\", ob->valuestring); pya_ob_text = pya_tool_ob_text; }");
            } else if (props.ob.type === "number") {
              dispatchLines.push("    cJSON *ob = args ? cJSON_GetObjectItemCaseSensitive(args, \"ob\") : NULL;");
              dispatchLines.push("    if (ob && cJSON_IsNumber(ob)) { pya_ob_num = ob->valuedouble; }");
            } else if (props.ob.type === "boolean") {
              dispatchLines.push("    cJSON *ob = args ? cJSON_GetObjectItemCaseSensitive(args, \"ob\") : NULL;");
              dispatchLines.push("    if (ob && cJSON_IsBool(ob)) { pya_ob_bool = cJSON_IsTrue(ob); }");
            }
          }
          if (isInterpretTool && props.during && props.during.type === "number") {
            dispatchLines.push("    cJSON *during = args ? cJSON_GetObjectItemCaseSensitive(args, \"during\") : NULL;");
            dispatchLines.push("    if (during && cJSON_IsNumber(during)) { pya_tool_during = during->valuedouble; }");
          }
          if (isInterpretTool && props.as && props.as.type === "string") {
            dispatchLines.push("    cJSON *as = args ? cJSON_GetObjectItemCaseSensitive(args, \"as\") : NULL;");
            dispatchLines.push("    if (as && cJSON_IsString(as)) { snprintf(pya_tool_as_text, sizeof(pya_tool_as_text), \"%s\", as->valuestring); }");
          }
          if (props.from && props.from.type === "number") {
            dispatchLines.push("    cJSON *from = args ? cJSON_GetObjectItemCaseSensitive(args, \"from\") : NULL;");
            dispatchLines.push("    if (from && cJSON_IsNumber(from)) { pya_from_num = from->valuedouble; }");
          }
          if (isInterpretTool) {
            dispatchLines.push("    const char *__pyaLang = pya_tool_as_text[0] ? pya_tool_as_text : \"javascript\";");
            dispatchLines.push("    if (strcmp(__pyaLang, \"javascript\") != 0) {");
            dispatchLines.push("      if (args) cJSON_Delete(args);");
            dispatchLines.push("      return NULL;");
            dispatchLines.push("    }");
            dispatchLines.push("    const char *__pyaScript = (pya_ob_text && pya_ob_text[0]) ? pya_ob_text : \"\";");
            dispatchLines.push("    char __pyaTempDir[] = \"/tmp/pyash-interpret-XXXXXX\";");
            dispatchLines.push("    if (!mkdtemp(__pyaTempDir)) { if (args) cJSON_Delete(args); return NULL; }");
            dispatchLines.push("    char __pyaCwd[PYA_TEXT_CAP];");
            dispatchLines.push("    if (!getcwd(__pyaCwd, sizeof(__pyaCwd))) { if (args) cJSON_Delete(args); return NULL; }");
            dispatchLines.push("    char __pyaWasmtime[PYA_TEXT_CAP];");
            dispatchLines.push("    char __pyaQuickjs[PYA_TEXT_CAP];");
            dispatchLines.push("    snprintf(__pyaWasmtime, sizeof(__pyaWasmtime), \"%s/caterer/wasmtime/bin/wasmtime\", __pyaCwd);");
            dispatchLines.push("    snprintf(__pyaQuickjs, sizeof(__pyaQuickjs), \"%s/caterer/quickjs-wasi/qjs.wasm\", __pyaCwd);");
            dispatchLines.push("    char __pyaScriptPath[PYA_TEXT_CAP];");
            dispatchLines.push("    snprintf(__pyaScriptPath, sizeof(__pyaScriptPath), \"%s/script.js\", __pyaTempDir);");
            dispatchLines.push("    FILE *__pyaScriptFile = fopen(__pyaScriptPath, \"w\");");
            dispatchLines.push("    if (!__pyaScriptFile) { if (args) cJSON_Delete(args); return NULL; }");
            dispatchLines.push("    fputs(__pyaScript, __pyaScriptFile);");
            dispatchLines.push("    fclose(__pyaScriptFile);");
            dispatchLines.push("    char __pyaCmd[PYA_TEXT_CAP];");
            dispatchLines.push("    snprintf(__pyaCmd, sizeof(__pyaCmd), \"\\\"%s\\\" run --dir \\\"%s\\\" \\\"%s\\\" -- \\\"%s\\\"\", __pyaWasmtime, __pyaTempDir, __pyaQuickjs, __pyaScriptPath);");
            dispatchLines.push("    char *__pyaOut = pya_command(__pyaCmd);");
            dispatchLines.push("    remove(__pyaScriptPath);");
            dispatchLines.push("    rmdir(__pyaTempDir);");
            dispatchLines.push("    if (!__pyaOut) { if (args) cJSON_Delete(args); return NULL; }");
            dispatchLines.push("    snprintf(pya_tool_output, sizeof(pya_tool_output), \"%s\", __pyaOut);");
            dispatchLines.push("    free(__pyaOut);");
          } else {
            dispatchLines.push("    pya_tool_output[0] = '\\0';");
            dispatchLines.push("    pya_tool_capture = 1;");
            dispatchLines.push(`    ${toolName}();`);
            dispatchLines.push("    pya_tool_capture = 0;");
          }
          dispatchLines.push("    if (args) cJSON_Delete(args);");
          dispatchLines.push("    return pya_strdup(pya_tool_output);");
          dispatchLines.push("  }");
        }
        dispatchLines.push("  if (args) cJSON_Delete(args);");
        dispatchLines.push("  return NULL;");
        dispatchLines.push("}");
        cState.preMain.push(dispatchLines.join("\n"));
      }
    }
  }
  const callPrompt = sentence.fromtext?.name ?? sentence.fromtext?.text ?? null;
  const lines = ["{"];
  if (callPrompt) {
    lines.push(`pya_mind_set_config(${JSON.stringify(mindName)}, NULL, NULL, ${JSON.stringify(callPrompt)}, 0);`);
  }
  lines.push(`const char *dialogue = ${JSON.stringify(String(dialogue))};`);
  if (toolVar) {
    lines.push(`char *tool_block = pya_tool_block_from_map(&${toolVar});`);
  } else {
    lines.push("char *tool_block = NULL;");
  }
  lines.push("int __pyaAnswerCount = 0;");
  lines.push(`const char *tool_json = ${toolJsonLiteral};`);
  lines.push(`char *reply = pya_mind_invoke(${JSON.stringify(mindName)}, dialogue, ${userText}, tool_block, tool_json, ${toolDispatchName}, ${explicitModel}, ${windowVal !== null ? Number(windowVal) || 8 : 0}, &__pyaAnswerCount);`);
  lines.push("if (!reply) reply = pya_strdup(\"\");");
  lines.push("char __pyaAnswerName[PYA_TEXT_CAP];");
  lines.push(`snprintf(__pyaAnswerName, sizeof(__pyaAnswerName), \"%s answer %d\", ${JSON.stringify(mindName)}, __pyaAnswerCount);`);
  lines.push("char __pyaQuestionName[PYA_TEXT_CAP];");
  lines.push(`snprintf(__pyaQuestionName, sizeof(__pyaQuestionName), \"%s %s question %d\", ${JSON.stringify(mindName)}, dialogue, __pyaAnswerCount);`);
  lines.push("char __pyaDialogueAnswerName[PYA_TEXT_CAP];");
  lines.push(`snprintf(__pyaDialogueAnswerName, sizeof(__pyaDialogueAnswerName), \"%s %s answer %d\", ${JSON.stringify(mindName)}, dialogue, __pyaAnswerCount);`);
  lines.push("char __pyaEscaped[PYA_TEXT_CAP];");
  lines.push("pya_escape_text(reply, __pyaEscaped, sizeof(__pyaEscaped));");
  lines.push("char __pyaToolResult[PYA_TEXT_CAP];");
  lines.push(`snprintf(__pyaToolResult, sizeof(__pyaToolResult), \"su name %s from name ${mindName} ob text \\\"%s\\\" be answer ya\", __pyaAnswerName, __pyaEscaped);`);
  lines.push("char __pyaToolEvoked[PYA_TEXT_CAP];");
  lines.push(`snprintf(__pyaToolEvoked, sizeof(__pyaToolEvoked), \"%s\", ${JSON.stringify(sentenceToPyash(sentence))});`);
  lines.push("char __pyaToolEvent[PYA_TEXT_CAP];");
  lines.push("snprintf(__pyaToolEvent, sizeof(__pyaToolEvent), \"su name tool event %d ob la %s ko to la %s ko be tool ya\", pya_next_tool_event_id(), __pyaToolEvoked, __pyaToolResult);");
  lines.push("pya_emit_exchange(__pyaToolEvent);");
  lines.push("printf(\"%s\\n\", reply);");
  lines.push("if (tool_block) free(tool_block);");
  lines.push("free(reply);");
  lines.push("}");
  return lines.join("\n");
}
