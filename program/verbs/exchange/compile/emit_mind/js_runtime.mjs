function historyWindowLiteral(windowValue, fallbackExpression = "cfg.window") {
  const numeric = Number(windowValue);
  if (windowValue !== null && windowValue !== undefined && Number.isFinite(numeric)) {
    return String(Math.max(0, Math.trunc(numeric)));
  }
  return `(Number.isFinite(Number(${fallbackExpression})) ? Math.max(0, Math.trunc(Number(${fallbackExpression}))) : 8)`;
}

export function handleMindSentenceJs(context, helpers) {
  const {
    sentence,
    ob,
    declaredTypes,
    jsHelpers,
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

  if (mindShim) mindShim.used = true;

  const mindName = sentence.for?.name ?? sentence.to?.name ?? ob.to?.name ?? sentence.su?.name ?? "mind";

  if (sentence.mood === "ya") {
    if (declaredTypes) declaredTypes.set(mindName, "mind");
    const space = sentence.from?.name ?? ob.space ?? null;
    const model = sentence.as?.name ?? ob.model ?? null;
    const prompt = sentence.fromtext?.name ?? sentence.fromtext?.text ?? ob.text ?? null;
    const session = sentence.accordingto?.name ?? sentence.accordingto?.text ?? null;
    const window = sentence.by?.num ?? sentence.by?.quantity?.num ?? sentence.ob?.window?.num ?? ob.window?.num ?? null;
    const windowLiteral = historyWindowLiteral(window, "cfg.window");
    const lines = [];
    lines.push(`mindConfigs.set(${JSON.stringify(mindName)}, {`);
    if (space) lines.push(`  space: ${JSON.stringify(space)},`);
    if (model) lines.push(`  model: ${JSON.stringify(model)},`);
    if (prompt) lines.push(`  prompt: ${JSON.stringify(prompt)},`);
    if (window !== null && window !== undefined && Number.isFinite(Number(window))) lines.push(`  window: ${windowLiteral},`);
    if (session) lines.push(`  session: ${JSON.stringify(session)},`);
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
  const sessionName = sentence.accordingto?.name ?? sentence.accordingto?.text ?? null;
  const promptName = sentence.fromtext?.name ?? null;
  if (sentence.with?.name || sessionName || promptName) {
    if (jsHelpers) jsHelpers.usesVectorFormat = true;
    if (rememberFlag) rememberFlag.used = true;
  }
  lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
  lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
  lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3.5:9b\""};`);
  const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? ob.window?.num ?? null;
  const windowLiteral = historyWindowLiteral(windowVal, "cfg.window");
  const dialogue = `${mindName} story`;
  lines.push(`const dialogue = ${JSON.stringify(String(dialogue))};`);
  lines.push(`const session = ${sessionName ? JSON.stringify(String(sessionName)) : "null"} || cfg.session || null;`);
  lines.push("let historyMessages = [];");
  lines.push(`const historyWindow = ${windowLiteral};`);
  lines.push("if (session) {");
  lines.push("  const series = typeof remember === \"function\" ? remember(session) : null;");
  lines.push("  const entries = Array.isArray(series?.ob?.series) ? series.ob.series : [];");
  lines.push("  historyMessages = entries.map((entry) => {");
  lines.push("    if (!entry || typeof entry !== \"object\") return null;");
  lines.push("    const role = entry?.role ?? entry?.su?.name ?? entry?.su?.text ?? entry?.from?.name ?? null;");
  lines.push("    const content = entry?.content ?? entry?.ob?.text ?? (typeof entry?.ob?.num === \"number\" ? String(entry.ob.num) : null);");
  lines.push("    if (!role || content == null) return null;");
  lines.push("    return { role: String(role).toLowerCase(), content: String(content) };");
  lines.push("  }).filter(Boolean);");
  lines.push("  if (historyWindow > 0) {");
  lines.push("    const max = historyWindow * 2;");
  lines.push("    historyMessages = historyMessages.slice(-max);");
  lines.push("  } else {");
  lines.push("    historyMessages = [];");
  lines.push("  }");
  lines.push("} else {");
  lines.push("  historyMessages = buildMindHistory(dialogue, historyWindow);");
  lines.push("}");
  lines.push("const messages = [];");
  lines.push(`const callPromptOverride = ${sentence.fromtext?.name ? JSON.stringify(sentence.fromtext.name) : (sentence.fromtext?.text ? JSON.stringify(sentence.fromtext.text) : "null")};`);
  lines.push("let systemPrompt = callPromptOverride || cfg.prompt || null;");
  lines.push("if (systemPrompt) {");
  lines.push("  const promptFact = typeof remember === \"function\" ? remember(systemPrompt) : null;");
  lines.push("  if (promptFact?.ob?.text !== undefined) systemPrompt = String(promptFact.ob.text);");
  lines.push("}");
  lines.push("if (systemPrompt) messages.push({ role: \"system\", content: systemPrompt });");
  if (sentence.with?.name) {
    const toolMapName = JSON.stringify(sentence.with.name);
    lines.push(`const toolMap = remember(${toolMapName});`);
    lines.push("const toolEntries = toolMap?.ob?.map ?? {};");
    lines.push("const toolKeys = Object.keys(toolEntries).sort(compareUtf8);");
    lines.push("const toolLines = toolKeys.map(k => { const entry = toolEntries[k]; return (entry?.mood && entry?.be) ? formatSentence(entry) : \"\"; }).filter(Boolean);");
    lines.push("if (toolLines.length) messages.push({ role: \"system\", content: `TOOLS:\\n${toolLines.join(\"\\n\")}` });");
  }
  lines.push("messages.push(...historyMessages);");
  lines.push(`messages.push({ role: \"user\", content: ${userText} });`);
  lines.push("const lastResponse = await callMind({ host, model, messages, numCtx: cfg.numCtx || 8192 });");
  lines.push("const reply = lastResponse?.message?.content ?? lastResponse?.response ?? lastResponse?.output ?? String(lastResponse ?? \"\");");
  const resVar = sanitizeName(resultName);
  lines.push("if (session) {");
  lines.push("  const series = typeof remember === \"function\" ? remember(session) : null;");
  lines.push("  const entries = Array.isArray(series?.ob?.series) ? [...series.ob.series] : [];");
  lines.push(`  entries.push({ mood: \"ya\", su: { name: \"user\" }, ob: { text: ${userText} }, be: \"write\" });`);
  lines.push("  entries.push({ mood: \"ya\", su: { name: \"assistant\" }, ob: { text: reply }, be: \"answer\" });");
  lines.push("  if (series && typeof series === \"object\") {");
  lines.push("    series.ob = { series: entries };");
  lines.push("    globalThis[session] = series;");
  lines.push("  }");
  lines.push("} else {");
  lines.push(`  recordMindTurn(dialogue, { role: \"user\", content: ${userText} }, { role: \"assistant\", content: reply }, ${windowLiteral});`);
  lines.push("}");
  lines.push("const __pyaAnswerCount = (mindAnswerCounters.get(dialogue) || 0) + 1;");
  lines.push("mindAnswerCounters.set(dialogue, __pyaAnswerCount);");
  lines.push(`const ${resVar} = { su: { name: ${JSON.stringify(mindName)} + \" answer \" + __pyaAnswerCount }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: \"answer\", mood: \"ya\" };`);
  lines.push(`globalThis[${resVar}.su.name] = ${resVar};`);
  lines.push(`globalThis.result = { ...${resVar}, su: { name: \"result\" } };`);
  lines.push(`const __pyaQuestionName = ${JSON.stringify(mindName)} + \" \" + dialogue + \" question \" + __pyaAnswerCount;`);
  lines.push(`globalThis[__pyaQuestionName] = { su: { name: __pyaQuestionName }, from: { name: \"user\" }, ob: { text: ${userText} }, be: \"write\", mood: \"ya\" };`);
  lines.push(`const __pyaDialogueAnswerName = ${JSON.stringify(mindName)} + \" \" + dialogue + \" answer \" + __pyaAnswerCount;`);
  lines.push(`globalThis[__pyaDialogueAnswerName] = { su: { name: __pyaDialogueAnswerName }, from: { name: ${JSON.stringify(mindName)} }, ob: { text: reply }, be: \"answer\", mood: \"ya\" };`);
  lines.push(`const __pyaToolEvoked = ${JSON.stringify(sentenceToPyash(sentence))};`);
  lines.push(`const __pyaToolResult = \"su name \" + ${JSON.stringify(mindName)} + \" answer \" + __pyaAnswerCount + \" from name \" + ${JSON.stringify(mindName)} + \" ob text \" + JSON.stringify(reply) + \" be answer ya\";`);
  lines.push(`pyaEmitNewspaper(\`su name tool event \${pyaNextToolEventId()} ob la \${__pyaToolEvoked} ko to la \${__pyaToolResult} ko be tool ya\`);`);
  lines.push(`console.log(${resVar}.ob?.text ?? ${resVar}.ob?.num);`);
  lines.push("}");
  return lines.join("\n");
}
