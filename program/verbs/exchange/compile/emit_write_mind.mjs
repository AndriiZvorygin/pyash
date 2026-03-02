function historyWindowLiteral(windowValue, fallbackExpression = "cfg.window") {
  const numeric = Number(windowValue);
  if (windowValue !== null && windowValue !== undefined && Number.isFinite(numeric)) {
    return String(Math.max(0, Math.trunc(numeric)));
  }
  return `(Number.isFinite(Number(${fallbackExpression})) ? Math.max(0, Math.trunc(Number(${fallbackExpression}))) : 8)`;
}

export function handleMindWrite(context, helpers) {
  const {
    sentence,
    baseBe,
    lang,
    ob,
    declaredTypes,
    mindShim,
    rememberFlag,
    jsHelpers,
    mapDefs
  } = context;
  const { sanitizeName, sentenceToPyash } = helpers;

  if (!(baseBe === "write" && lang !== "c")) return null;
  const hasMindTarget =
    sentence.for?.name ||
    sentence.totext?.name ||
    (sentence.to?.name && declaredTypes?.get(sentence.to.name) === "mind");
  if (!hasMindTarget) return null;

  if (mindShim) mindShim.used = true;
  const mindName = sentence.for?.name ?? sentence.to?.name;
  const outputName = sentence.for?.name ? sentence.to?.name : sentence.totext?.name;
  const resultName = sentence.su?.name ?? mindName;
  const promptVal = typeof ob.text === "string" ? JSON.stringify(ob.text) : JSON.stringify(ob.name ?? "");
  const explicitModel = ob.model ? JSON.stringify(ob.model) : null;
  const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
  const agentCwd = sentence.at?.filename ?? sentence.at?.text ?? sentence.at?.name ?? null;
  const lines = ["{"]; // block scope to avoid duplicate const per call
  if (sentence.with?.name) {
    if (jsHelpers) jsHelpers.usesVectorFormat = true;
    if (rememberFlag) rememberFlag.used = true;
    if (jsHelpers && mapDefs?.has(sentence.with.name)) {
      const mapSentence = mapDefs.get(sentence.with.name);
      const entries = mapSentence?.ob?.map ?? {};
      for (const entry of Object.values(entries)) {
        if (entry?.be === "interpret") {
          jsHelpers.usesInterpret = true;
          jsHelpers.usesFs = true;
          jsHelpers.usesPath = true;
          jsHelpers.usesOs = true;
          jsHelpers.usesCommand = true;
          break;
        }
      }
    }
  }
  if (sentence.with?.name && agentCwd) {
    const toolMapDef = mapDefs?.get(sentence.with.name);
    const sandpit = toolMapDef?.as?.wo === "sandpit" || toolMapDef?.as?.text === "sandpit";
    if (sandpit) {
      lines.push("globalThis[\"agent sandbox\"] = { su: { name: \"agent sandbox\" }, ob: { boolean: true }, be: \"truth\", mood: \"ya\" };");
      lines.push(`globalThis["agent cwd"] = { su: { name: "agent cwd" }, ob: { filename: ${JSON.stringify(String(agentCwd))} }, be: "cwd", mood: "ya" };`);
    }
  }
  lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
  lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
  lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3.5:9b\""};`);
  const dialogue = sentence.from?.text
    ?? sentence.fromtext?.name
    ?? sentence.fromtext?.text
    ?? `${mindName} story`;
  const windowLiteral = historyWindowLiteral(windowVal, "cfg.window");
  lines.push(`const dialogue = ${JSON.stringify(String(dialogue))};`);
  lines.push(`const historyMessages = buildMindHistory(dialogue, ${windowLiteral});`);
  lines.push("const messages = [];");
  lines.push("if (cfg.prompt) messages.push({ role: \"system\", content: cfg.prompt });");
  if (sentence.with?.name) {
    const toolMapName = JSON.stringify(sentence.with.name);
    lines.push(`const toolMapFact = remember(${toolMapName});`);
    lines.push("const toolEntries = toolMapFact?.ob?.map ?? {};");
    lines.push("const toolSchemas = buildToolSchemas(toolEntries);");
    lines.push("const tools = toolSchemas.tools;");
    lines.push("const toolMap = toolSchemas.toolMap;");
    lines.push("if (toolSchemas.toolBlock) messages.push({ role: \"system\", content: toolSchemas.toolBlock });");
  } else {
    lines.push("const tools = [];");
    lines.push("const toolMap = new Map();");
  }
  lines.push("messages.push(...historyMessages);");
  lines.push(`messages.push({ role: "user", content: ${promptVal} });`);
  lines.push("let reply = \"\";");
  lines.push("let lastResponse = null;");
  lines.push("let turns = 0;");
  lines.push("const maxToolTurns = 6;");
  lines.push("while (turns < maxToolTurns) {");
  lines.push("  turns += 1;");
  lines.push("  const requestPayload = { model, messages, tools, stream: false };");
  lines.push(`  recordMindJson(${JSON.stringify(mindName)}, "request", requestPayload);`);
  lines.push("  lastResponse = await callMind({ host, model, messages, tools, numCtx: cfg.numCtx || 8192 });");
  lines.push(`  recordMindJson(${JSON.stringify(mindName)}, "response", stripMindContext(lastResponse));`);
  lines.push("  const toolCalls = lastResponse?.message?.tool_calls;");
  lines.push("  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {");
  lines.push("    reply = lastResponse?.message?.content ?? \"\";");
  lines.push("    break;");
  lines.push("  }");
  lines.push("  const assistantMessage = { role: \"assistant\", content: lastResponse?.message?.content ?? \"\", tool_calls: toolCalls };");
  lines.push("  messages.push(assistantMessage);");
  lines.push("  for (const call of toolCalls) {");
  lines.push("    const toolName = call?.function?.name ?? call?.name;");
  lines.push("    const toolCallId = call?.id ?? null;");
  lines.push("    if (!toolName || !toolMap.has(toolName)) { throw new Error(`tool defective: unknown tool ${toolName}`); }");
  lines.push("    const capability = toolMap.get(toolName);");
  lines.push("    const toolSentence = buildToolSentence({ capability, args: call?.function?.arguments ?? call?.arguments });");
  lines.push("    const toolFn = globalThis?.[toolName];");
  lines.push("    let toolResult;");
  lines.push("    if (typeof toolFn === \"function\") {");
  lines.push("      toolResult = await Promise.resolve(toolFn(toolSentence));");
  lines.push("    } else if (toolSentence?.be === \"interpret\") {");
  lines.push("      if (typeof pyaInterpret !== \"function\") { throw new Error(\"tool defective: interpret runtime missing\"); }");
  lines.push("      const scriptText = toolSentence?.ob?.text ?? toolSentence?.ob?.name ?? \"\";");
  lines.push("      const timeoutRaw = toolSentence?.during?.num ?? toolSentence?.during?.text ?? toolSentence?.during?.name;");
  lines.push("      const timeoutValue = typeof timeoutRaw === \"number\" ? timeoutRaw : Number(timeoutRaw);");
  lines.push("      const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? Math.max(1, Math.trunc(timeoutValue * 1000)) : 500;");
  lines.push("      const out = pyaInterpret(scriptText, timeoutMs);");
  lines.push("      toolResult = { su: { name: \"result\" }, ob: { text: String(out ?? \"\") }, be: \"interpret\", mood: \"ya\" };");
  lines.push("    } else {");
  lines.push("      throw new Error(`tool defective: missing function ${toolName}`);");
  lines.push("    }");
  lines.push("    let toolText = \"\";");
  lines.push("    if (toolResult && typeof toolResult === \"object\") {");
  lines.push("      if (toolResult.be === \"interpret\" && typeof toolResult.ob?.text === \"string\") {");
  lines.push("        const rawText = toolResult.ob.text;");
  lines.push("        const match = rawText.match(/^quoted\\.([^.]+)\\.([\\s\\S]*?)\\.\\1\\.quoted$/);");
  lines.push("        toolText = match ? match[2] : rawText;");
  lines.push("      } else {");
  lines.push("        toolText = formatSentence(toolResult);");
  lines.push("      }");
  lines.push("    } else {");
  lines.push("      toolText = String(toolResult ?? \"\");");
  lines.push("    }");
  lines.push("    const toolMessage = { role: \"tool\", content: toolText };");
  lines.push("    if (toolCallId) toolMessage.tool_call_id = toolCallId;");
  lines.push("    toolMessage.tool_name = toolName;");
  lines.push("    messages.push(toolMessage);");
  lines.push("  }");
  lines.push("}");
  lines.push("if (!reply) reply = lastResponse?.message?.content ?? \"\";");
  const resVar = sanitizeName(resultName);
  lines.push(`recordMindTurn(dialogue, { role: "user", content: ${promptVal} }, { role: "assistant", content: reply }, ${windowLiteral});`);
  lines.push("const __pyaAnswerCount = (mindAnswerCounters.get(dialogue) || 0) + 1;");
  lines.push("mindAnswerCounters.set(dialogue, __pyaAnswerCount);");
  lines.push(`const ${resVar} = { su: { name: ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
  lines.push(`globalThis[${resVar}.su.name] = ${resVar};`);
  lines.push(`globalThis.result = { ...${resVar}, su: { name: "result" } };`);
  if (outputName) {
    lines.push(`globalThis[${JSON.stringify(outputName)}] = { ...${resVar}, su: { name: ${JSON.stringify(outputName)} } };`);
  }
  lines.push(`const __pyaQuestionName = ${JSON.stringify(mindName)} + " " + dialogue + " question " + __pyaAnswerCount;`);
  lines.push(`globalThis[__pyaQuestionName] = { su: { name: __pyaQuestionName }, from: { name: "user" }, ob: { text: ${promptVal} }, be: "write", mood: "ya" };`);
  lines.push(`const __pyaDialogueAnswerName = ${JSON.stringify(mindName)} + " " + dialogue + " answer " + __pyaAnswerCount;`);
  lines.push(`globalThis[__pyaDialogueAnswerName] = { su: { name: __pyaDialogueAnswerName }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: "answer", mood: "ya" };`);
  lines.push(`const __pyaToolEvoked = ${JSON.stringify(sentenceToPyash(sentence))};`);
  lines.push(`const __pyaToolResult = "su name " + ${JSON.stringify(mindName)} + " answer " + __pyaAnswerCount + " from name " + ${JSON.stringify(mindName)} + " ob text " + JSON.stringify(reply) + " be answer ya";`);
  lines.push(`pyaEmitNewspaper(\`su name tool event \${pyaNextToolEventId()} ob la \${__pyaToolEvoked} ko to la \${__pyaToolResult} ko be tool ya\`);`);
  lines.push(`console.log(${resVar}.ob?.text ?? ${resVar}.ob?.num);`);
  lines.push("}");
  return lines.join("\n");
}
