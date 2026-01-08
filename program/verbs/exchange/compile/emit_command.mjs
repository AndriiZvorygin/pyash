import { throwErrorSentence } from "../../../error.mjs";

export function handleCommandSentence({
  sentence,
  baseBe,
  lang,
  sentenceArg,
  locals,
  declared,
  declaredTypes,
  jsHelpers,
  cHelpers,
  cState
}, {
  sentenceToPyash,
  sanitizeName,
  markDeclared,
  exprForSlot
} = {}) {
  if (baseBe !== "command") return null;

  const inputFilename = sentence.from?.filename;
  const inputText = sentence.fromtext?.text;
  if (lang !== "c") {
    if (jsHelpers) {
      jsHelpers.usesCommand = true;
      jsHelpers.usesExchange = true;
      if (inputFilename || sentence?.to?.filename) jsHelpers.usesFs = true;
    }
    const cmdExpr = exprForSlot(sentence.ob, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text ?? ${sentenceArg}.ob?.wo` : undefined,
      field: "text"
    });
    const inputExpr = inputFilename
      ? `fs.readFileSync(${JSON.stringify(inputFilename)}, "utf8")`
      : (inputText != null ? JSON.stringify(inputText) : "undefined");
    const lines = ["{"];
    lines.push(`const __pyaToolEvoked = ${JSON.stringify(sentenceToPyash(sentence))};`);
    lines.push(`const __pyaCmd = ${cmdExpr ?? '""'};`);
    lines.push(`if (!__pyaCmd) { pyaEmitNewspaper(\`su name command defective ob text "command defective: empty command" from la \${__pyaToolEvoked} ko be error ya\`); throw new Error("command defective"); }`);
    lines.push("let __pyaOut;");
    lines.push("try {");
    lines.push(`  __pyaOut = pyaCommand(__pyaCmd, ${inputExpr});`);
    lines.push("} catch (err) {");
    lines.push("  const __pyaMsg = `command defective: ${String(err?.message ?? \"command defective\")}`;");
    lines.push("  pyaEmitNewspaper(`su name command defective ob text ${JSON.stringify(__pyaMsg)} from la ${__pyaToolEvoked} ko be error ya`);");
    lines.push("  throw err;");
    lines.push("}");
    if (sentence?.to?.filename) {
      lines.push(`fs.writeFileSync(${JSON.stringify(sentence.to.filename)}, String(__pyaOut ?? ""));`);
    }
    if (sentence?.to?.name) {
      const target = sanitizeName(sentence.to.name);
      if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
      markDeclared(declared, sentence.to.name);
      lines.push(`const ${target} = { su: { name: ${JSON.stringify(sentence.to.name)} }, ob: { text: String(__pyaOut ?? "") }, be: "text", mood: "ya" };`);
      lines.push(`globalThis[${JSON.stringify(sentence.to.name)}] = ${target};`);
    }
    const toolTarget = JSON.stringify(sentence.to?.name ?? "result");
    lines.push(`const __pyaToolResult = "su name " + ${toolTarget} + " ob text " + JSON.stringify(String(__pyaOut ?? "")) + " be text ya";`);
    lines.push(`pyaEmitNewspaper(\`su name tool event \${pyaNextToolEventId()} ob la \${__pyaToolEvoked} ko to la \${__pyaToolResult} ko be tool ya\`);`);
    lines.push("}");
    return lines.join("\n");
  }
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesCommand = true;
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesExchange = true;
    }
    if (inputFilename || inputText) {
      throwErrorSentence({
        name: "command defective",
        message: "command defective",
        from: { name: "compile" },
        raw: { reason: "stdin unsupported in c" }
      });
    }
    const cmdExpr = exprForSlot(sentence.ob, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text` : undefined,
      field: "text"
    });
    const outVar = `cmd_out_${cState?.fileCounter ?? 0}`;
    if (cState) cState.fileCounter += 1;
    const lines = [];
    const evoked = JSON.stringify(sentenceToPyash(sentence));
    lines.push(`const char *__pyaCmd = ${cmdExpr ?? '""'};`);
    lines.push(`if (!__pyaCmd || !strlen(__pyaCmd)) { char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\"command defective: empty command\\\" from la %s ko be error ya", ${evoked}); pya_emit_exchange(__pyaErr); exit(1); }`);
    lines.push(`char *${outVar} = pya_command(__pyaCmd);`);
    lines.push(`if (!${outVar}) { char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\"command defective\\\" from la %s ko be error ya", ${evoked}); pya_emit_exchange(__pyaErr); exit(1); }`);
    if (sentence?.to?.filename) {
      const safePath = JSON.stringify(sentence.to.filename);
      const fileVar = `out_${cState?.fileCounter ?? 0}`;
      if (cState) cState.fileCounter += 1;
      lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
      lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${outVar} ? ${outVar} : ""); fclose(${fileVar}); }`);
    }
    if (sentence?.to?.name) {
      const target = sanitizeName(sentence.to.name);
      if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
      markDeclared(declared, sentence.to.name);
      lines.push(`char ${target}[PYA_TEXT_CAP];`);
      lines.push(`snprintf(${target}, sizeof(${target}), "%s", ${outVar} ? ${outVar} : "");`);
    }
    const toolTarget = JSON.stringify(sentence.to?.name ?? "result");
    lines.push(`{ char __pyaEsc[PYA_TEXT_CAP]; pya_escape_text(${outVar} ? ${outVar} : "", __pyaEsc, sizeof(__pyaEsc)); char __pyaEvent[PYA_TEXT_CAP]; snprintf(__pyaEvent, sizeof(__pyaEvent), "su name tool event %06d ob la %s ko to la su name %s ob text \\\"%s\\\" be text ya ko be tool ya", pya_next_tool_event_id(), ${evoked}, ${toolTarget}, __pyaEsc); pya_emit_exchange(__pyaEvent); }`);
    lines.push(`if (${outVar}) free(${outVar});`);
    return lines.join("\n");
  }
  return null;
}
