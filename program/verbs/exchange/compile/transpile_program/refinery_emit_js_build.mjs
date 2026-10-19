import { sentenceToPyash } from "../../../../beautiful.mjs";
import { sanitizeName } from "../util.mjs";

export function buildRefineryJsDefinitions({
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
} = {}) {
  const lines = [];
  lines.push(`__pyaRefineries[${JSON.stringify(refineryName)}] = { order: ${JSON.stringify(refinery.platforms.map(platform => platform.name))}, platforms: {} };`);
  refinery.platforms.forEach((platform) => {
    const fnName = sanitizeName(`pya_refinery_${refineryName}_${platform.name}`);
    const actionLine = sentenceToPyash(platform.action);
    const evokeLine = `ob la ${actionLine} ko be evoke ya`;
    const bodyLine = transpileSentence(platform.action, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
    if (typeof bodyLine === "string" && bodyLine.includes("remember(")) usesRememberShim = true;
    if (rememberFlag.used) {
      usesRememberShim = true;
      rememberFlag.used = false;
    }
    if (typeof bodyLine === "string" && bodyLine.includes("runAtAll(")) {
      usesMapShim = true;
      usesRememberShim = true;
    }
    const bodyLines = (bodyLine ?? "// TODO: platform action")
      .split("\n")
      .map(line => `  ${line}`);
    lines.push(`function ${fnName}() {`);
    lines.push(...bodyLines);
    lines.push("}");
    const duration = platform.action?.during?.num ?? null;
    const timebox = platform.action?.atmost?.num ?? null;
    lines.push(`__pyaRefineries[${JSON.stringify(refineryName)}].platforms[${JSON.stringify(platform.name)}] = { deps: ${JSON.stringify(platform.deps)}, duration: ${JSON.stringify(duration)}, timebox: ${JSON.stringify(timebox)}, run: ${fnName}, evoke: ${JSON.stringify(evokeLine)}, result: ${JSON.stringify(actionLine)} };`);
  });
  return { lines, usesRememberShim, usesMapShim };
}
