export function handleMindSentence(context, helpers) {
  const {
    sentence,
    baseBe,
    lang,
    ob,
    declaredTypes,
    jsHelpers,
    cHelpers,
    cState,
    mapDefs,
    mindShim,
    rememberFlag
  } = context;
  const {
    buildToolSchemasForCompile,
    compareUtf8,
    sanitizeName,
    sentenceToPyash
  } = helpers;

  if (baseBe !== "mind") return null;

  if (lang === "c") {
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
      const prompt = sentence.accordingto?.name ?? ob.text ?? null;
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
    const dialogue = sentence.from?.text
      ?? sentence.fromtext?.name
      ?? sentence.fromtext?.text
      ?? `${mindName} story`;
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
            if (!toolName) continue;
            const props = tool?.function?.parameters?.properties ?? {};
            dispatchLines.push(`  if (strcmp(name, ${JSON.stringify(toolName)}) == 0) {`);
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
            if (props.from && props.from.type === "number") {
              dispatchLines.push("    cJSON *from = args ? cJSON_GetObjectItemCaseSensitive(args, \"from\") : NULL;");
              dispatchLines.push("    if (from && cJSON_IsNumber(from)) { pya_from_num = from->valuedouble; }");
            }
            dispatchLines.push(`    ${toolName}();`);
            dispatchLines.push("    if (args) cJSON_Delete(args);");
            dispatchLines.push("    return pya_strdup(\"\");");
            dispatchLines.push("  }");
          }
          dispatchLines.push("  if (args) cJSON_Delete(args);");
          dispatchLines.push("  return NULL;");
          dispatchLines.push("}");
          cState.preMain.push(dispatchLines.join("\n"));
        }
      }
    }
    const lines = ["{"];
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
    lines.push(`snprintf(__pyaAnswerName, sizeof(__pyaAnswerName), "%s answer %d", ${JSON.stringify(mindName)}, __pyaAnswerCount);`);
    lines.push("char __pyaQuestionName[PYA_TEXT_CAP];");
    lines.push(`snprintf(__pyaQuestionName, sizeof(__pyaQuestionName), "%s %s question %d", ${JSON.stringify(mindName)}, dialogue, __pyaAnswerCount);`);
    lines.push("char __pyaDialogueAnswerName[PYA_TEXT_CAP];");
    lines.push(`snprintf(__pyaDialogueAnswerName, sizeof(__pyaDialogueAnswerName), "%s %s answer %d", ${JSON.stringify(mindName)}, dialogue, __pyaAnswerCount);`);
    lines.push("char __pyaEscaped[PYA_TEXT_CAP];");
    lines.push("pya_escape_text(reply, __pyaEscaped, sizeof(__pyaEscaped));");
    lines.push("char __pyaToolResult[PYA_TEXT_CAP];");
    lines.push(`snprintf(__pyaToolResult, sizeof(__pyaToolResult), "su name %s from name ${mindName} ob text \\\"%s\\\" be answer ya", __pyaAnswerName, __pyaEscaped);`);
    lines.push("char __pyaToolEvoked[PYA_TEXT_CAP];");
    lines.push(`snprintf(__pyaToolEvoked, sizeof(__pyaToolEvoked), "%s", ${JSON.stringify(sentenceToPyash(sentence))});`);
    lines.push("char __pyaToolEvent[PYA_TEXT_CAP];");
    lines.push("snprintf(__pyaToolEvent, sizeof(__pyaToolEvent), \"su name tool event %d ob la %s ko to la %s ko be tool ya\", pya_next_tool_event_id(), __pyaToolEvoked, __pyaToolResult);");
    lines.push("pya_emit_exchange(__pyaToolEvent);");
    lines.push("printf(\"%s\\n\", reply);");
    lines.push("if (tool_block) free(tool_block);");
    lines.push("free(reply);");
    lines.push("}");
    return lines.join("\n");
  }
  if (mindShim) mindShim.used = true;

  const mindName = sentence.for?.name ?? sentence.to?.name ?? ob.to?.name ?? sentence.su?.name ?? "mind";

  if (sentence.mood === "ya") {
    if (declaredTypes) declaredTypes.set(mindName, "mind");
    const space = sentence.from?.name ?? ob.space ?? null;
    const model = sentence.as?.name ?? ob.model ?? null;
    const prompt = sentence.accordingto?.name ?? ob.text ?? null;
    const window = sentence.by?.num ?? sentence.by?.quantity?.num ?? sentence.ob?.window?.num ?? ob.window?.num ?? null;
    const lines = [];
    lines.push(`mindConfigs.set(${JSON.stringify(mindName)}, {`);
    if (space) lines.push(`  space: ${JSON.stringify(space)},`);
    if (model) lines.push(`  model: ${JSON.stringify(model)},`);
    if (prompt) lines.push(`  prompt: ${JSON.stringify(prompt)},`);
    if (window) lines.push(`  window: ${Number(window) || 8},`);
    lines.push("});");
    return lines.join("\n");
  }

  const resultName = sentence.su?.name ?? "mind_result";
  const explicitModel = ob.model ? JSON.stringify(ob.model) : null;
  const userText = ob.text
    ? JSON.stringify(ob.text)
    : ob.name
      ? JSON.stringify(ob.name)
      : "\"\"";
  const lines = ["{"];
  if (sentence.with?.name) {
    if (jsHelpers) jsHelpers.usesVectorFormat = true;
    if (rememberFlag) rememberFlag.used = true;
  }
  lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
  lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
  lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3-vl:8b-instruct\""};`);
  const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
  const dialogue = sentence.from?.text
    ?? sentence.fromtext?.name
    ?? sentence.fromtext?.text
    ?? `${mindName} story`;
  lines.push(`const dialogue = ${JSON.stringify(String(dialogue))};`);
  lines.push(`const historyMessages = buildMindHistory(dialogue, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
  lines.push("const messages = [];");
  lines.push("if (cfg.prompt) messages.push({ role: \"system\", content: cfg.prompt });");
  if (sentence.with?.name) {
    const toolMapName = JSON.stringify(sentence.with.name);
    lines.push(`const toolMap = remember(${toolMapName});`);
    lines.push("const toolEntries = toolMap?.ob?.map ?? {};");
    lines.push("const toolKeys = Object.keys(toolEntries).sort(compareUtf8);");
    lines.push("const toolLines = toolKeys.map(k => { const entry = toolEntries[k]; return (entry?.mood && entry?.be) ? formatSentence(entry) : \"\"; }).filter(Boolean);");
    lines.push("if (toolLines.length) messages.push({ role: \"system\", content: `TOOLS:\\n${toolLines.join(\"\\n\")}` });");
  }
  lines.push("messages.push(...historyMessages);");
  lines.push(`messages.push({ role: "user", content: ${userText} });`);
  lines.push("const lastResponse = await callMind({ host, model, messages, numCtx: cfg.numCtx || 8192 });");
  lines.push("const reply = lastResponse?.message?.content ?? lastResponse?.response ?? lastResponse?.output ?? String(lastResponse ?? \"\");");
  const resVar = sanitizeName(resultName);
  lines.push(`recordMindTurn(dialogue, { role: "user", content: ${userText} }, { role: "assistant", content: reply }, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
  lines.push("const __pyaAnswerCount = (mindAnswerCounters.get(dialogue) || 0) + 1;");
  lines.push("mindAnswerCounters.set(dialogue, __pyaAnswerCount);");
  lines.push(`const ${resVar} = { su: { name: ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
  lines.push(`globalThis[${resVar}.su.name] = ${resVar};`);
  lines.push(`globalThis.result = { ...${resVar}, su: { name: "result" } };`);
  lines.push(`const __pyaQuestionName = ${JSON.stringify(mindName)} + " " + dialogue + " question " + __pyaAnswerCount;`);
  lines.push(`globalThis[__pyaQuestionName] = { su: { name: __pyaQuestionName }, from: { name: "user" }, ob: { text: ${userText} }, be: "write", mood: "ya" };`);
  lines.push(`const __pyaDialogueAnswerName = ${JSON.stringify(mindName)} + " " + dialogue + " answer " + __pyaAnswerCount;`);
  lines.push(`globalThis[__pyaDialogueAnswerName] = { su: { name: __pyaDialogueAnswerName }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
  lines.push(`const __pyaToolEvoked = ${JSON.stringify(sentenceToPyash(sentence))};`);
  lines.push(`const __pyaToolResult = "su name " + ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount + " from name " + ${JSON.stringify(mindName)} + " ob text " + JSON.stringify(reply) + " be answer ya";`);
  lines.push(`pyaEmitNewspaper(\`su name tool event \${pyaNextToolEventId()} ob la \${__pyaToolEvoked} ko to la \${__pyaToolResult} ko be tool ya\`);`);
  lines.push(`console.log(${resVar}.ob?.text ?? ${resVar}.ob?.num);`);
  lines.push("}");
  return lines.join("\n");
}
