export function handleJsonFromPyash({
  sentence,
  ob,
  lang,
  wantJson,
  jsonMode,
  declaredTypes,
  jsHelpers,
  cHelpers,
  rememberFlag,
  cState,
  isWrite
}, {
  sanitizeName
}) {
  if (!wantJson) return { expr: null, forced: false, code: null };
  const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
  const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
  if (isJsonMap || !isPyashText) return { expr: null, forced: false, code: null };

  if (lang !== "c") {
    if (jsHelpers) jsHelpers.usesJsonRuntime = true;
    const sourceExpr = typeof ob.text === "string"
      ? JSON.stringify(ob.text)
      : `remember(${JSON.stringify(ob.name ?? "")})?.ob?.text ?? ""`;
    if (rememberFlag) rememberFlag.used = true;
    const rootName = JSON.stringify(sentence?.su?.name ?? "");
    const mode = jsonMode === "pretty" ? "pretty" : "canonical";
    return {
      expr: `pyashToJsonTextRuntime(${sourceExpr}, ${rootName}, ${JSON.stringify(mode)})`,
      forced: true,
      code: null
    };
  }

  if (cHelpers) {
    cHelpers.usesJsonRuntime = true;
    cHelpers.usesTextHelper = true;
    cHelpers.usesString = true;
    cHelpers.usesStdlib = true;
    cHelpers.usesPrintf = true;
    cHelpers.usesCtype = true;
  }
  const tmpName = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_json`);
  const errName = `${tmpName}_err`;
  const rootName = sentence?.su?.name ? JSON.stringify(sentence.su.name) : "NULL";
  const sourceExpr = typeof ob.text === "string"
    ? JSON.stringify(ob.text)
    : (ob.name ? sanitizeName(ob.name) : "NULL");
  const lines = [];
  lines.push(`char ${tmpName}[PYA_TEXT_CAP] = "";`);
  lines.push(`pya_json_error ${errName} = { "", 0, 0 };`);
  lines.push(`if (!pya_pyash_to_json(${sourceExpr}, ${rootName}, ${tmpName}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
  const writeFilename = sentence?.to?.filename;
  if (writeFilename) {
    const safePath = JSON.stringify(writeFilename);
    const fileVar = `out_${cState?.fileCounter ?? 0}`;
    if (cState) cState.fileCounter += 1;
    lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
    lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpName}); fclose(${fileVar}); }`);
    if (!isWrite) lines.push(`printf("%s\\n", ${tmpName});`);
  } else {
    lines.push(`printf("%s\\n", ${tmpName});`);
  }
  return { expr: null, forced: true, code: lines.join("\n") };
}
