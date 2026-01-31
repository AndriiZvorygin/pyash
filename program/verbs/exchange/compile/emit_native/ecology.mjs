import { throwErrorSentence } from "../../../../error.mjs";

export function handleNativeEcology(context, helpers) {
  const { sentence, baseBe, lang, locals, declared, declaredTypes, cHelpers, jsHelpers, rememberFlag } = context;
  const { sanitizeName, markDeclared, inlineSentenceLiteral } = helpers;
  if (baseBe !== "ecology") return null;
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
      lines.push(`char ${targetVar}[PYA_TEXT_CAP] = \"\";`);
      markDeclared(declared, targetName);
    }
    if (declaredTypes) declaredTypes.set(targetName, "text");
    lines.push("{");
    lines.push(`  const char *__pyaEnv = getenv(${JSON.stringify(targetName)});`);
    lines.push(`  snprintf(${targetVar}, sizeof(${targetVar}), \"%s\", __pyaEnv ? __pyaEnv : \"null\");`);
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
      `  const __pyaEnvFact = { su: { name: ${JSON.stringify(mapName)} }, be: \"map\", ob: { map: __pyaEnvMap }, mood: \"ya\" };`,
      `  globalThis[${JSON.stringify(mapName)}] = __pyaEnvFact;`,
      `  const __pyaEnvResult = { su: { name: \"ecology\" }, be: \"ecology\", ob: { name: ${JSON.stringify(mapName)} }, mood: \"ya\" };`,
      `  globalThis.result = { ...__pyaEnvResult, su: { name: \"result\" } };`,
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
        return `${nameVar}.ob?.text ?? ${nameVar}.ob?.num ?? (${nameVar}.ob?.boolean ? \"truth\" : \"lie\")`;
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
  lines.push(`  ${targetVar} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: __pyaValue, hollow: __pyaMissing }, be: \"ecology\", mood: \"ya\" };`);
  lines.push(`  globalThis[${JSON.stringify(targetName)}] = ${targetVar};`);
  lines.push(`  globalThis.result = { ...${targetVar}, su: { name: \"result\" } };`);
  lines.push("}");
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, "text");
  return lines.join("\n");
}
