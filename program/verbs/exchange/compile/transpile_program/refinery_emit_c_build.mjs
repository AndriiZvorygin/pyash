import { sentenceToPyash } from "../../../../beautiful.mjs";
import { sanitizeName } from "../util.mjs";

export function buildRefineryCForDefinition({
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
} = {}) {
  const lines = [];
  const mainLines = [];
  const prefix = sanitizeName(`pya_refinery_${refineryName}`);
  const nameVar = `${prefix}_names`;
  const runVar = `${prefix}_runs`;
  const depsVar = `${prefix}_deps`;
  const depCountVar = `${prefix}_dep_counts`;
  const actionVar = `${prefix}_actions`;
  const depLookup = `${prefix}_find`;
  const runFn = `${prefix}_run`;
  const count = refinery.platforms.length;
  const depArrays = [];
  const runFns = [];
  const names = [];
  const actions = [];
  refinery.platforms.forEach((platform) => {
    const fnName = sanitizeName(`${prefix}_${platform.name}`);
    const actionLine = sentenceToPyash(platform.action);
    const actionEvoke = `ob la ${actionLine} ko be evoke ya`;
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
    const linesBody = (bodyLine ?? "/* TODO: platform action */")
      .split("\n")
      .map(line => `  ${line}`);
    lines.push(`static void ${fnName}(void) {`);
    lines.push(...linesBody);
    lines.push("}");
    runFns.push(fnName);
    names.push(platform.name);
    actions.push({ evoke: actionEvoke, result: actionLine });
    const depName = sanitizeName(`${prefix}_${platform.name}_deps`);
    const deps = platform.deps.map(dep => JSON.stringify(dep)).join(", ");
    depArrays.push(`static const char *${depName}[] = { ${deps}${deps ? ", " : ""}NULL };`);
  });
  lines.push(...depArrays);
  lines.push(`static const char *${nameVar}[] = { ${names.map(n => JSON.stringify(n)).join(", ")} };`);
  lines.push(`static void (*${runVar}[])(void) = { ${runFns.join(", ")} };`);
  lines.push(`static const char **${depsVar}[] = { ${refinery.platforms.map(p => sanitizeName(`${prefix}_${p.name}_deps`)).join(", ")} };`);
  lines.push(`static const int ${depCountVar}[] = { ${refinery.platforms.map(p => p.deps.length).join(", ")} };`);
  lines.push(`static const char *${actionVar}[] = { ${actions.map(action => JSON.stringify(action.result)).join(", ")} };`);
  lines.push(`static const char *${actionVar}_evoke[] = { ${actions.map(action => JSON.stringify(action.evoke)).join(", ")} };`);
  lines.push(`static int ${depLookup}(const char *name) {`);
  lines.push(`  for (int i = 0; i < ${count}; i++) { if (strcmp(${nameVar}[i], name) == 0) return i; }`);
  lines.push("  return -1;");
  lines.push("}");
  lines.push(`static int ${runFn}(void) {`);
  lines.push(`  const char *refineryName = ${JSON.stringify(refineryName)};`);
  lines.push(`  const int retry_max_attempts = ${Math.max(1, Math.floor(effectiveRetryConfig.maxAttempts || 1))};`);
  lines.push(`  const int retry_initial_delay_ms = ${Math.max(0, Math.trunc(effectiveRetryConfig.initialDelayMs || 0))};`);
  lines.push(`  const int retry_max_delay_ms = ${Math.max(0, Math.trunc(effectiveRetryConfig.maxDelayMs || 0))};`);
  lines.push(`  const double retry_backoff = ${Math.max(1, Number(effectiveRetryConfig.backoff || 1))};`);
  lines.push("  const int checkpoint_enabled = getenv(\"PYA_NO_CHECKPOINT\") ? 0 : 1;");
  lines.push("  pya_load_checkpoints();");
  lines.push(`  int done[${count}];`);
  lines.push(`  const char *results[${count}];`);
  lines.push(`  for (int i = 0; i < ${count}; i++) { done[i] = 0; results[i] = NULL; }`);
  lines.push("  int completed = 0;");
  lines.push(`  while (completed < ${count}) {`);
  lines.push("    int next = -1;");
  lines.push(`    for (int i = 0; i < ${count}; i++) {`);
  lines.push("      if (done[i]) continue;");
  lines.push("      int ready = 1;");
  lines.push(`      for (int d = 0; d < ${depCountVar}[i]; d++) {`);
  lines.push(`        int idx = ${depLookup}(${depsVar}[i][d]);`);
  lines.push("        if (idx < 0 || !done[idx]) { ready = 0; break; }");
  lines.push("      }");
  lines.push("      if (!ready) continue;");
  lines.push("      if (next < 0 || strcmp(" + nameVar + "[i], " + nameVar + "[next]) < 0) next = i;");
  lines.push("    }");
  lines.push("    if (next < 0) return 1;");
  lines.push(`    const int depCount = ${depCountVar}[next];`);
  lines.push(`    const char **depNames = ${depsVar}[next];`);
  lines.push("    const char *depResults[(depCount > 0 ? depCount : 1)];");
  lines.push("    for (int d = 0; d < depCount; d++) {");
  lines.push(`      int idx = ${depLookup}(depNames[d]);`);
  lines.push("      depResults[d] = (idx >= 0 && results[idx]) ? results[idx] : \"\";");
  lines.push("    }");
  lines.push("    char checkpointHash[16];");
  lines.push(`    pya_checkpoint_hash(${actionVar}[next], depNames, depResults, depCount, checkpointHash);`);
  lines.push("    if (checkpoint_enabled) {");
  lines.push(`      const char *checkpointResult = pya_find_checkpoint(refineryName, ${nameVar}[next], checkpointHash);`);
  lines.push("      if (checkpointResult) {");
  lines.push("        char checkpointLine[PYA_TEXT_CAP];");
  lines.push("        snprintf(checkpointLine, sizeof(checkpointLine), \"su name %s ob text \\\"%s\\\" from name %s to la %s ko be checkpoint ya\", " + nameVar + "[next], checkpointHash, refineryName, checkpointResult);");
  lines.push("        pya_emit_exchange(checkpointLine);");
  lines.push("        pya_emit_exchange(checkpointResult);");
  lines.push("        results[next] = checkpointResult;");
  lines.push("        done[next] = 1;");
  lines.push("        completed += 1;");
  lines.push("        continue;");
  lines.push("      }");
  lines.push("    }");
  lines.push("    int attempt = 0;");
  lines.push("    int delay_ms = retry_initial_delay_ms;");
  lines.push("    while (attempt < retry_max_attempts) {");
  lines.push("      attempt += 1;");
  lines.push("      pya_exchange_reset_error();");
  lines.push(`      pya_emit_exchange(${actionVar}_evoke[next]);`);
  lines.push(`      ${runVar}[next]();`);
  lines.push("      if (pya_exchange_has_error()) {");
  lines.push("        if (attempt < retry_max_attempts) {");
  lines.push("          char retryLine[PYA_TEXT_CAP];");
  lines.push("          char retryMsg[PYA_TEXT_CAP];");
  lines.push("          pya_escape_text(pya_exchange_error_text(), retryMsg, sizeof(retryMsg));");
  lines.push("          snprintf(retryLine, sizeof(retryLine), \"su name %s by num %d ob text \\\"%s\\\" from name %s be reiterate ya\", " + nameVar + "[next], attempt + 1, retryMsg, refineryName);");
  lines.push("          pya_emit_exchange(retryLine);");
  lines.push("          pya_sleep_ms(delay_ms);");
  lines.push("          int next_delay = (int)(delay_ms * retry_backoff);");
  lines.push("          if (next_delay > retry_max_delay_ms) next_delay = retry_max_delay_ms;");
  lines.push("          delay_ms = next_delay;");
  lines.push("          continue;");
  lines.push("        }");
  lines.push("        return 1;");
  lines.push("      }");
  lines.push(`      pya_emit_exchange(${actionVar}[next]);`);
  lines.push(`      results[next] = ${actionVar}[next];`);
  lines.push("      if (checkpoint_enabled) {");
  lines.push("        char checkpointLine[PYA_TEXT_CAP];");
  lines.push("        snprintf(checkpointLine, sizeof(checkpointLine), \"su name %s ob text \\\"%s\\\" from name %s to la %s ko be checkpoint ya\", " + nameVar + "[next], checkpointHash, refineryName, " + actionVar + "[next]);");
  lines.push("        pya_emit_exchange(checkpointLine);");
  lines.push("      }");
  lines.push("      done[next] = 1;");
  lines.push("      completed += 1;");
  lines.push("      break;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return 0;");
  lines.push("}");
  mainLines.push(`if (getenv(\"PYA_REFINERY\") && strcmp(getenv(\"PYA_REFINERY\"), ${JSON.stringify(refineryName)}) == 0) { if (${runFn}() != 0) return 1; }`);
  return { lines, mainLines, usesRememberShim, usesMapShim };
}
