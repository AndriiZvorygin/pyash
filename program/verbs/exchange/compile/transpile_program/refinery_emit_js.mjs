import { buildRefineryJsPreludeLines } from "./refinery_emit_js_prelude.mjs";
import { buildRefineryJsDefinitions } from "./refinery_emit_js_build.mjs";

export function emitRefineryJs({
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
    return { lines: [], usesRememberShim, usesMapShim };
  }
  jsHelpers.usesFs = true;
  const lines = buildRefineryJsPreludeLines(effectiveRetryConfig);
  for (const [refineryName, refinery] of refineryDefs.entries()) {
    const result = buildRefineryJsDefinitions({
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
      transpileSentence,
      usesRememberShim,
      usesMapShim
    });
    lines.push(...result.lines);
    usesRememberShim = result.usesRememberShim;
    usesMapShim = result.usesMapShim;
  }
  lines.push("const __pyaRefineryName = (typeof process !== \"undefined\" ? process.env?.PYA_REFINERY : undefined) || (typeof globalThis !== \"undefined\" ? globalThis.PYA_REFINERY : undefined);");
  lines.push("if (__pyaRefineryName) __pyaRunRefinery(__pyaRefineryName);");
  return { lines, usesRememberShim, usesMapShim };
}
