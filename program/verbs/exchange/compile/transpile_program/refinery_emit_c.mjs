import { buildRefineryCPreludeLines } from "./refinery_emit_c_prelude.mjs";
import { buildRefineryCForDefinition } from "./refinery_emit_c_build.mjs";

export function emitRefineryC({
  refineryDefs,
  lang,
  ceremonyFns,
  declared,
  declaredTypes,
  declaredVectorTypes,
  loopShim,
  mindShim,
  cHelpers,
  rememberFlag,
  jsHelpers,
  cState,
  mapDefs,
  effectiveRetryConfig,
  transpileSentence,
  usesRememberShim,
  usesMapShim
} = {}) {
  if (!refineryDefs || refineryDefs.size === 0) {
    return { lines: [], mainLines: [], usesRememberShim, usesMapShim };
  }
  cHelpers.usesStdlib = true;
  cHelpers.usesString = true;
  cHelpers.usesCtype = true;
  cHelpers.usesExchange = true;
  const lines = buildRefineryCPreludeLines();
  const mainLines = [];
  for (const [refineryName, refinery] of refineryDefs.entries()) {
    const result = buildRefineryCForDefinition({
      refineryName,
      refinery,
      lang,
      ceremonyFns,
      declared,
      declaredTypes,
      declaredVectorTypes,
      loopShim,
      mindShim,
      cHelpers,
      rememberFlag,
      jsHelpers,
      cState,
      mapDefs,
      effectiveRetryConfig,
      transpileSentence,
      usesRememberShim,
      usesMapShim
    });
    lines.push(...result.lines);
    mainLines.push(...result.mainLines);
    usesRememberShim = result.usesRememberShim;
    usesMapShim = result.usesMapShim;
  }
  return { lines, mainLines, usesRememberShim, usesMapShim };
}
