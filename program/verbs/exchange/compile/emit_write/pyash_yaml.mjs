export function handleYamlFromPyash({
  sentence,
  ob,
  lang,
  wantYaml,
  declaredTypes,
  jsHelpers,
  cHelpers,
  rememberFlag,
  cState,
  isWrite
}, {
  sanitizeName
}) {
  if (!wantYaml) return { expr: null, forced: false, code: null };
  const isJsonMap = ob.name && declaredTypes?.get(ob.name) === "json map";
  const isPyashText = typeof ob.text === "string" || (ob.name && (declaredTypes?.get(ob.name) === "pyash" || declaredTypes?.get(ob.name) === "text"));
  if (isJsonMap || !isPyashText) return { expr: null, forced: false, code: null };

  if (lang !== "c") {
    if (jsHelpers) {
      jsHelpers.usesYamlStringify = true;
      jsHelpers.usesJsonRuntime = true;
      jsHelpers.usesVectorFormat = true;
    }
    const sourceExpr = typeof ob.text === "string"
      ? JSON.stringify(ob.text)
      : `remember(${JSON.stringify(ob.name ?? "")})?.ob?.text ?? ""`;
    if (rememberFlag) rememberFlag.used = true;
    const rootName = JSON.stringify(sentence?.su?.name ?? "");
    return {
      expr: `yamlStringifyRuntime(JSON.parse(pyashToJsonTextRuntime(${sourceExpr}, ${rootName}, "canonical")))`,
      forced: true,
      code: null
    };
  }

  if (cHelpers) {
    cHelpers.usesYamlStringify = true;
    cHelpers.usesJsonRuntime = true;
    cHelpers.usesTextHelper = true;
    cHelpers.usesString = true;
    cHelpers.usesStdlib = true;
    cHelpers.usesPrintf = true;
    cHelpers.usesCtype = true;
  }
  const tmpJson = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_json`);
  const tmpYaml = sanitizeName(`${sentence?.su?.name ?? ob.name ?? "pyash"}_yaml`);
  const errName = `${tmpYaml}_err`;
  const rootName = sentence?.su?.name ? JSON.stringify(sentence.su.name) : "NULL";
  const sourceExpr = typeof ob.text === "string"
    ? JSON.stringify(ob.text)
    : (ob.name ? sanitizeName(ob.name) : "NULL");
  const lines = [];
  lines.push(`char ${tmpJson}[PYA_TEXT_CAP] = "";`);
  lines.push(`char ${tmpYaml}[PYA_TEXT_CAP] = "";`);
  lines.push(`pya_json_error ${tmpJson}_err = { "", 0, 0 };`);
  lines.push(`if (!pya_pyash_to_json(${sourceExpr}, ${rootName}, ${tmpJson}, &${tmpJson}_err)) { fprintf(stderr, "%s\\n", ${tmpJson}_err.message); }`);
  lines.push(`pya_yaml_error ${errName} = { "", 0, 0 };`);
  lines.push(`if (!pya_json_to_yaml(${tmpJson}, ${tmpYaml}, &${errName})) { fprintf(stderr, "%s\\n", ${errName}.message); }`);
  const writeFilename = sentence?.to?.filename;
  if (writeFilename) {
    const safePath = JSON.stringify(writeFilename);
    const fileVar = `out_${cState?.fileCounter ?? 0}`;
    if (cState) cState.fileCounter += 1;
    lines.push(`FILE *${fileVar} = fopen(${safePath}, "w");`);
    lines.push(`if (${fileVar}) { fprintf(${fileVar}, "%s", ${tmpYaml}); fclose(${fileVar}); }`);
    if (!isWrite) lines.push(`printf("%s\\n", ${tmpYaml});`);
  } else {
    lines.push(`printf("%s\\n", ${tmpYaml});`);
  }
  return { expr: null, forced: true, code: lines.join("\n") };
}
