export function handleCommandSentence({
  sentence,
  baseBe,
  lang,
  sentenceArg,
  locals,
  localsTypes,
  declared,
  declaredTypes,
  jsHelpers,
  cHelpers,
  cState
}, {
  sentenceToPyash,
  sanitizeName,
  markDeclared,
  exprForSlot,
  cExpr
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
    lines.push("const __pyaRequestName = pyaNextCommandRequestId();");
    lines.push("pyaEmitNewspaper(`exists su name ${__pyaRequestName} ob la ${__pyaToolEvoked} ko be evoke ya`);");
    lines.push(`const __pyaCmd = ${cmdExpr ?? '""'};`);
    lines.push(`if (!__pyaCmd) { pyaEmitNewspaper(\`su name command defective ob text "command defective: empty command" from la \${__pyaToolEvoked} ko be error ya\`); throw new Error("command defective"); }`);
    lines.push(`pyaCommandPolicyGate({ requestName: __pyaRequestName, evoked: __pyaToolEvoked, commandText: __pyaCmd, mood: ${JSON.stringify(sentence.mood ?? "do")} });`);
    lines.push("let __pyaOut;");
    lines.push("try {");
    lines.push(`  __pyaOut = pyaCommand(__pyaCmd, ${inputExpr});`);
    lines.push("} catch (err) {");
    lines.push("  const __pyaMsg = `command defective: ${String(err?.message ?? \"command defective\")}`;");
    lines.push("  const __pyaErrorResult = `su name command defective ob text ${JSON.stringify(__pyaMsg)} from la ${__pyaToolEvoked} ko be error ya`;");
    lines.push("  pyaCommandResultAudit({ requestName: __pyaRequestName, commandText: __pyaCmd, evoked: __pyaToolEvoked, decision: \"error\", result: __pyaErrorResult });");
    lines.push("  pyaEmitNewspaper(`su name command defective ob text ${JSON.stringify(__pyaMsg)} from la ${__pyaToolEvoked} ko be error ya`);");
    lines.push("  throw err;");
    lines.push("}");
    if (sentence?.to?.filename) {
      lines.push(`fs.mkdirSync(path.dirname(${JSON.stringify(sentence.to.filename)}), { recursive: true });`);
      lines.push(`fs.writeFileSync(${JSON.stringify(sentence.to.filename)}, String(__pyaOut ?? ""));`);
      lines.push(`pyaRecordArtifact(${JSON.stringify(sentence.to.filename)}, Buffer.from(String(__pyaOut ?? ""), "utf8"), "write", __pyaRequestName);`);
    }
    if (sentence?.to?.name) {
      const target = sanitizeName(sentence.to.name);
      const needsDecl = !locals?.has(target) && !declared?.has(target) && !declared?.has(sentence.to.name);
      if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
      markDeclared(declared, sentence.to.name);
      if (needsDecl) {
        lines.unshift(`let ${target};`);
        locals?.add(target);
      }
      lines.push(`${target} = { su: { name: ${JSON.stringify(sentence.to.name)} }, ob: { text: String(__pyaOut ?? "") }, be: "text", mood: "ya" };`);
      lines.push(`globalThis[${JSON.stringify(sentence.to.name)}] = ${target};`);
    }
    if (sentence?.su?.name) {
      lines.push(`globalThis[${JSON.stringify(sentence.su.name)}] = { su: { name: ${JSON.stringify(sentence.su.name)} }, ob: { text: String(__pyaOut ?? "") }, be: "text", mood: "ya" };`);
    }
    lines.push("const result = { su: { name: __pyaRequestName }, ob: { text: String(__pyaOut ?? \"\") }, be: \"command\", mood: \"ya\" };");
    lines.push("globalThis[__pyaRequestName] = result;");
    lines.push("globalThis.result = { su: { name: \"result\" }, ob: result.ob, be: \"command\", mood: \"ya\" };");
    lines.push(`pyaEmitNewspaper("su name " + __pyaRequestName + " ob text " + JSON.stringify(String(__pyaOut ?? "")) + " be command ya");`);
    lines.push("const __pyaToolResult = \"su name \" + __pyaRequestName + \" ob text \" + JSON.stringify(String(__pyaOut ?? \"\")) + \" be command ya\";");
    lines.push("pyaCommandResultAudit({ requestName: __pyaRequestName, commandText: __pyaCmd, evoked: __pyaToolEvoked, decision: \"allow\", result: __pyaToolResult });");
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
    const cmdExpr = exprForSlot(sentence.ob, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: sentenceArg ? `${sentenceArg}.ob?.text` : undefined,
      field: "text"
    });
    const cmdCExpr = cExpr ? cExpr(cmdExpr) : cmdExpr;
    const commandNonce = cState?.fileCounter ?? 0;
    if (cState) cState.fileCounter += 1;
    const cmdVar = `__pyaCmd_${commandNonce}`;
    const cmdWithInputVar = `__pyaCmdWithInput_${commandNonce}`;
    const outVar = `cmd_out_${commandNonce}`;
    const requestVar = `__pyaRequest_${commandNonce}`;
    const lines = [];
    const evoked = JSON.stringify(sentenceToPyash(sentence));
    lines.push(`char ${requestVar}[PYA_TEXT_CAP]; pya_next_command_request_id(${requestVar}, sizeof(${requestVar}));`);
    lines.push(`{ char __pyaRequestLine[PYA_TEXT_CAP]; snprintf(__pyaRequestLine, sizeof(__pyaRequestLine), "exists su name %s ob la %s ko be evoke ya", ${requestVar}, ${evoked}); pya_emit_exchange(__pyaRequestLine); }`);
    lines.push(`const char *${cmdVar} = ${cmdCExpr ?? '""'};`);
    lines.push(`if (!${cmdVar} || !strlen(${cmdVar})) { char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\"command defective: empty command\\\" from la %s ko be error ya", ${evoked}); pya_emit_exchange(__pyaErr); exit(1); }`);
    lines.push(`pya_command_policy_gate(${requestVar}, ${evoked}, ${cmdVar}, ${JSON.stringify(sentence.mood ?? "do")});`);
    let runCmdExpr = cmdVar;
    let cleanupStdinLine = null;
    if (inputFilename) {
      lines.push(`char ${cmdWithInputVar}[PYA_TEXT_CAP];`);
      lines.push(`snprintf(${cmdWithInputVar}, sizeof(${cmdWithInputVar}), "%s < \\\"%s\\\"", ${cmdVar}, ${JSON.stringify(inputFilename)});`);
      runCmdExpr = cmdWithInputVar;
    } else if (inputText != null) {
      const inFileVar = `__pyaCmdInputFile_${cState?.fileCounter ?? 0}`;
      const inFdVar = `__pyaCmdInputFd_${cState?.fileCounter ?? 0}`;
      const inFilePtr = `__pyaCmdInputFp_${cState?.fileCounter ?? 0}`;
      if (cState) cState.fileCounter += 1;
      lines.push(`char ${inFileVar}[] = "/tmp/pyash-cmd-input-XXXXXX";`);
      lines.push(`int ${inFdVar} = mkstemp(${inFileVar});`);
      lines.push(`if (${inFdVar} < 0) { char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\"command defective: stdin temp failed\\\" from la %s ko be error ya", ${evoked}); pya_emit_exchange(__pyaErr); exit(1); }`);
      lines.push(`FILE *${inFilePtr} = fdopen(${inFdVar}, "w");`);
      lines.push(`if (!${inFilePtr}) { close(${inFdVar}); remove(${inFileVar}); char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\"command defective: stdin write failed\\\" from la %s ko be error ya", ${evoked}); pya_emit_exchange(__pyaErr); exit(1); }`);
      lines.push(`fputs(${JSON.stringify(inputText)}, ${inFilePtr});`);
      lines.push(`fclose(${inFilePtr});`);
      lines.push(`char ${cmdWithInputVar}[PYA_TEXT_CAP];`);
      lines.push(`snprintf(${cmdWithInputVar}, sizeof(${cmdWithInputVar}), "%s < \\\"%s\\\"", ${cmdVar}, ${inFileVar});`);
      runCmdExpr = cmdWithInputVar;
      cleanupStdinLine = `remove(${inFileVar});`;
    }
    lines.push(`char *${outVar} = pya_command(${runCmdExpr});`);
    if (cleanupStdinLine) lines.push(cleanupStdinLine);
    lines.push(`if (!${outVar}) { char __pyaErr[PYA_TEXT_CAP]; snprintf(__pyaErr, sizeof(__pyaErr), "su name command defective ob text \\\"command defective\\\" from la %s ko be error ya", ${evoked}); pya_command_emit_audit(${requestVar}, "result", pya_command_classify(${cmdVar}), "error", ${evoked}, __pyaErr); pya_emit_exchange(__pyaErr); exit(1); }`);
    if (sentence?.to?.filename) {
      const safePath = JSON.stringify(sentence.to.filename);
      const fileVar = `out_${cState?.fileCounter ?? 0}`;
      const filePathVar = `out_path_${cState?.fileCounter ?? 0}`;
      if (cState) cState.fileCounter += 1;
      lines.push(`char ${filePathVar}[] = ${safePath};`);
      lines.push(`{ char *slash = strrchr(${filePathVar}, '/'); if (slash) { *slash = '\\0'; pya_mkdir_recursive(${filePathVar}); *slash = '/'; } }`);
      lines.push(`FILE *${fileVar} = fopen(${filePathVar}, "w");`);
      lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${outVar} ? ${outVar} : ""); fclose(${fileVar}); }`);
      lines.push(`pya_exchange_record_file(${filePathVar}, "write", ${requestVar});`);
    }
    if (sentence?.to?.name) {
      const target = sanitizeName(sentence.to.name);
      const needsDecl = !locals?.has(target) && !declared?.has(target) && !declared?.has(sentence.to.name);
      if (declaredTypes) declaredTypes.set(sentence.to.name, "text");
      markDeclared(declared, sentence.to.name);
      if (needsDecl) {
        lines.push(`char ${target}[PYA_TEXT_CAP] = "";`);
        locals?.add(target);
      }
      lines.push(`snprintf(${target}, sizeof(${target}), "%s", ${outVar} ? ${outVar} : "");`);
    } else if (!sentence?.to?.filename) {
      if (sentence?.su?.name) {
        const subject = sanitizeName(sentence.su.name);
        const needsDecl = !locals?.has(subject) && !declared?.has(subject) && !declared?.has(sentence.su.name);
        if (needsDecl) {
          lines.push(`char ${subject}[PYA_TEXT_CAP] = "";`);
          markDeclared(declared, sentence.su.name);
          locals?.add(subject);
        }
        if (declaredTypes) declaredTypes.set(sentence.su.name, "text");
        if (localsTypes) localsTypes.set(subject, "text");
        lines.push(`snprintf(${subject}, sizeof(${subject}), "%s", ${outVar} ? ${outVar} : "");`);
      }
      if (!locals?.has("result") && !declared?.has("result")) {
        lines.push("char result[PYA_TEXT_CAP] = \"\";");
        locals?.add("result");
        if (localsTypes) localsTypes.set("result", "text");
      }
    }
    if (locals?.has("result") || declared?.has("result") || declared?.has(sanitizeName("result"))) {
      lines.push(`snprintf(result, sizeof(result), "%s", ${outVar} ? ${outVar} : "");`);
    }
    lines.push(`{ char __pyaEscResult[PYA_TEXT_CAP]; pya_escape_text(${outVar} ? ${outVar} : "", __pyaEscResult, sizeof(__pyaEscResult)); char __pyaResultLine[PYA_TEXT_CAP]; snprintf(__pyaResultLine, sizeof(__pyaResultLine), "su name %s ob text \\\"%s\\\" be command ya", ${requestVar}, __pyaEscResult); pya_emit_exchange(__pyaResultLine); }`);
    lines.push(`{ char __pyaEscResult[PYA_TEXT_CAP]; pya_escape_text(${outVar} ? ${outVar} : "", __pyaEscResult, sizeof(__pyaEscResult)); char __pyaResultLine[PYA_TEXT_CAP]; snprintf(__pyaResultLine, sizeof(__pyaResultLine), "su name %s ob text \\\"%s\\\" be command ya", ${requestVar}, __pyaEscResult); pya_command_emit_audit(${requestVar}, "result", pya_command_classify(${cmdVar}), "allow", ${evoked}, __pyaResultLine); }`);
    lines.push(`{ char __pyaEsc[PYA_TEXT_CAP]; pya_escape_text(${outVar} ? ${outVar} : "", __pyaEsc, sizeof(__pyaEsc)); char __pyaEvent[PYA_TEXT_CAP]; snprintf(__pyaEvent, sizeof(__pyaEvent), "su name tool event %06d ob la %s ko to la su name %s ob text \\\"%s\\\" be command ya ko be tool ya", pya_next_tool_event_id(), ${evoked}, ${requestVar}, __pyaEsc); pya_emit_exchange(__pyaEvent); }`);
    lines.push(`if (${outVar}) free(${outVar});`);
    return lines.join("\n");
  }
  return null;
}
