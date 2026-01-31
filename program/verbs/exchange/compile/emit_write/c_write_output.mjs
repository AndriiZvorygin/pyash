export function handleCWriteOutput({
  sentence,
  ob,
  expr,
  wantCsv,
  wantYaml,
  isWrite,
  declaredTypes,
  localsTypes,
  locals,
  declared,
  cHelpers,
  cState,
  sentenceId
}, {
  sanitizeName
}) {
  if (cHelpers) cHelpers.usesPrintf = true;
  const isText = typeof ob.text === "string"
    || typeof ob.date === "string"
    || wantCsv
    || wantYaml
    || (ob.name && (declaredTypes?.get(ob.name) === "text" || declaredTypes?.get(ob.name) === "date" || declaredTypes?.get(ob.name) === "sentence" || declaredTypes?.get(ob.name) === "json map" || declaredTypes?.get(ob.name) === "map" || declaredTypes?.get(ob.name) === "csv map"))
    || (ob.name && (localsTypes?.get(sanitizeName(ob.name)) === "text" || localsTypes?.get(sanitizeName(ob.name)) === "date"))
    || (ob.name && !declaredTypes?.has(ob.name) && !(locals?.has(sanitizeName(ob.name)) || declared?.has(sanitizeName(ob.name)) || declared?.has(ob.name)));
  const fmt = (wantCsv || wantYaml) ? "%s" : (isText ? "%s" : "%g");
  const writeFilename = sentence?.to?.filename;
  if (writeFilename) {
    if (cHelpers) {
      cHelpers.usesStdlib = true;
      cHelpers.usesExchange = true;
      if (fmt === "%s") cHelpers.usesTextHelper = true;
    }
    const safePath = JSON.stringify(writeFilename);
    const fileVar = `out_${cState?.fileCounter ?? 0}`;
    if (cState) cState.fileCounter += 1;
    const writeLine = fmt === "%s"
      ? `pya_write_text_file(${safePath}, ${expr});\npya_exchange_record_file(${safePath}, "write", ${JSON.stringify(sentenceId)});`
      : `FILE *${fileVar} = fopen(${safePath}, "w");\nif (${fileVar}) { fprintf(${fileVar}, "${fmt}", ${expr}); fclose(${fileVar}); }\npya_exchange_record_file(${safePath}, "write", ${JSON.stringify(sentenceId)});`;
    if (isWrite) return writeLine;
    return (wantCsv || wantYaml) ? `${writeLine}\nprintf("%s", ${expr});` : `${writeLine}\nprintf("${fmt}\\n", ${expr});`;
  }
  return (wantCsv || wantYaml) ? `printf("%s", ${expr});` : `printf("${fmt}\\n", ${expr});`;
}
