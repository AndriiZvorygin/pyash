import path from "node:path";
import readline from "node:readline/promises";

async function askConfigureAnotherRelay() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = (await rl.question("Configure another relay [y/N]: ")).trim().toLowerCase();
    return value === "y" || value === "yes";
  } finally {
    rl.close();
  }
}

async function askContinueWithoutCodexLogin() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = (await rl.question("Continue without completed Codex login [y/N]: ")).trim().toLowerCase();
    return value === "y" || value === "yes";
  } finally {
    rl.close();
  }
}

function createMindWritePlan({
  rootDir,
  cfg,
  prior,
  readText,
  planManagedUpsert,
  buildMindRelaysBlock,
  buildMindConfigureBlock,
  buildMindDefaultsBlock,
  MIND_RELAYS_BLOCK_NAME,
  MIND_CONFIG_BLOCK_NAME,
  MIND_DEFAULTS_BLOCK_NAME,
  backendChoiceKey,
  DEFAULT_MIND_RELAY_NAME
}) {
  return (async () => {
    const secretPath = path.join(rootDir, "configure", "secret.pya");
    const secretExisting = await readText(secretPath);
    const mergedRelays = { ...(prior?.relays ?? {}) };
    mergedRelays[cfg.relayName] = {
      source: cfg.source || backendChoiceKey(cfg.backend),
      backend: cfg.backend,
      host: cfg.host,
      model: cfg.model,
      reasoningEffort: cfg.reasoningEffort || ""
    };
    let defaultRelay = cfg.setDefault ? cfg.relayName : String(prior?.defaultRelay || "").trim();
    if (!defaultRelay) defaultRelay = cfg.relayName;
    if (!mergedRelays[defaultRelay]) defaultRelay = cfg.relayName;
    const selectedCfg = mergedRelays[defaultRelay];

    const relaysPlan = planManagedUpsert({
      existing: secretExisting,
      blockName: MIND_RELAYS_BLOCK_NAME,
      content: buildMindRelaysBlock({ relays: mergedRelays, defaultRelay })
    });
    const configPlan = planManagedUpsert({
      existing: relaysPlan.nextText,
      blockName: MIND_CONFIG_BLOCK_NAME,
      content: buildMindConfigureBlock(selectedCfg)
    });
    const defaultsPlan = planManagedUpsert({
      existing: configPlan.nextText,
      blockName: MIND_DEFAULTS_BLOCK_NAME,
      content: buildMindDefaultsBlock(selectedCfg, { defaultRelay })
    });
    return {
      writes: [{
        path: secretPath,
        changed: relaysPlan.changed || configPlan.changed || defaultsPlan.changed,
        action: defaultsPlan.action,
        preview: [MIND_RELAYS_BLOCK_NAME, MIND_CONFIG_BLOCK_NAME, MIND_DEFAULTS_BLOCK_NAME],
        nextText: defaultsPlan.nextText
      }],
      changed: relaysPlan.changed || configPlan.changed || defaultsPlan.changed,
      resolvedDefaultRelay: defaultRelay,
      resolvedDefaultConfig: selectedCfg,
      relays: mergedRelays,
      defaultRelayFallback: DEFAULT_MIND_RELAY_NAME
    };
  })();
}

export function createConfigureMindCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    parseTruthy,
    loadMindConfigFromSecret,
    collectMindFromFlags,
    collectMindInteractive,
    mindVerification,
    mindLiveTest,
    runCodexAccountCommand,
    codexAccountPath,
    applyWritePlan,
    writePlanSummary,
    buildMindRelaysBlock,
    buildMindConfigureBlock,
    buildMindDefaultsBlock,
    readText,
    planManagedUpsert,
    backendChoiceKey,
    renderShortPreview,
    DEFAULT_MIND_RELAY_NAME,
    MIND_RELAYS_BLOCK_NAME,
    MIND_CONFIG_BLOCK_NAME,
    MIND_DEFAULTS_BLOCK_NAME,
    jsonOut,
    textOut
  } = deps;

  return async function configureMind({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const json = hasFlag(args, "--json");
    const print = hasFlag(args, "--print");
    const dryRun = hasFlag(args, "--dry-run");
    const nonInteractive = hasFlag(args, "--non-interactive");
    const testNowFlag = parseArgValue(args, "--test-now");
    const runTestNow = testNowFlag == null ? !nonInteractive : parseTruthy(testNowFlag, false);
    let workingPrior = await loadMindConfigFromSecret(rootDir);
    const runs = [];
    let lastPlan = null;

    while (true) {
      const cfg = nonInteractive
        ? collectMindFromFlags({ args, prior: workingPrior })
        : await collectMindInteractive({ prior: workingPrior, rootDir });

      const verification = mindVerification(cfg);
      if (!verification.ok) {
        const out = { ok: false, stage: "verification", verification, config: cfg };
        if (json) jsonOut(out);
        else {
          textOut("verification failed:");
          for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
        }
        process.exit(1);
      }

      let live = null;
      if (runTestNow) live = await mindLiveTest(cfg);
      let codexAuth = cfg.codexAuth ?? null;
      if (cfg.source === "openai-codex" && cfg.codexLogin && !cfg.codexLoginDone) {
        const codexJsonMode = nonInteractive || json;
        const codexRun = await runCodexAccountCommand({
          action: "login",
          codexBin: cfg.codexBin,
          cwd: rootDir,
          json: codexJsonMode,
          codexAccountPath
        });
        if (codexRun.code !== 0) {
          const errorText = codexJsonMode ? (codexRun.stderr || codexRun.stdout || "codex login failed") : "codex login failed";
          if (nonInteractive) {
            const out = { ok: false, stage: "codex auth", error: errorText.trim(), config: cfg };
            if (json) jsonOut(out);
            else textOut(`codex auth failed: ${out.error}`);
            process.exit(1);
          }
          textOut(`- codex auth failed: ${errorText.trim() || "unknown error"}`);
          const continueWithoutLogin = await askContinueWithoutCodexLogin();
          if (!continueWithoutLogin) process.exit(1);
          codexAuth = { ok: false, skipped: true, reason: "login failed and user chose continue" };
        } else if (codexJsonMode) {
          try {
            codexAuth = JSON.parse(codexRun.stdout || "{}");
          } catch {
            codexAuth = { ok: true };
          }
        } else {
          codexAuth = { ok: true };
        }
      }

      const plan = await createMindWritePlan({
        rootDir,
        cfg,
        prior: workingPrior,
        readText,
        planManagedUpsert,
        buildMindRelaysBlock,
        buildMindConfigureBlock,
        buildMindDefaultsBlock,
        MIND_RELAYS_BLOCK_NAME,
        MIND_CONFIG_BLOCK_NAME,
        MIND_DEFAULTS_BLOCK_NAME,
        backendChoiceKey,
        DEFAULT_MIND_RELAY_NAME
      });
      if (!dryRun) await applyWritePlan(plan);
      lastPlan = plan;

      const runOut = {
        ok: true,
        route: "configure mind",
        rootDir,
        dryRun,
        changed: plan.changed,
        writes: writePlanSummary(plan),
        verification,
        live,
        config: {
          relayName: cfg.relayName,
          setDefault: cfg.setDefault,
          source: cfg.source,
          backend: cfg.backend,
          host: cfg.host,
          model: cfg.model,
          reasoningEffort: cfg.reasoningEffort || "",
          codexLogin: cfg.codexLogin,
          defaultRelay: plan.resolvedDefaultRelay,
          relays: plan.relays
        },
        codexAuth
      };
      runs.push(runOut);
      workingPrior = {
        source: plan.resolvedDefaultConfig?.source ?? cfg.source,
        backend: plan.resolvedDefaultConfig?.backend ?? cfg.backend,
        host: plan.resolvedDefaultConfig?.host ?? cfg.host,
        model: plan.resolvedDefaultConfig?.model ?? cfg.model,
        reasoningEffort: plan.resolvedDefaultConfig?.reasoningEffort ?? cfg.reasoningEffort ?? "",
        defaultRelay: plan.resolvedDefaultRelay ?? cfg.relayName,
        relays: plan.relays ?? {}
      };

      if (nonInteractive) break;
      const again = await askConfigureAnotherRelay();
      if (!again) break;
    }

    const out = runs[runs.length - 1];
    if (json) {
      jsonOut(runs.length > 1 ? { ...out, runs } : out);
      return;
    }
    const relayNames = runs.map((entry) => entry?.config?.relayName).filter(Boolean);
    textOut(`configure mind complete${relayNames.length > 1 ? ` (${relayNames.length} relays)` : ""}`);
    for (const w of out.writes || []) {
      textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
    }
    if (relayNames.length > 0) textOut(`- relays configured ${relayNames.join(", ")}`);
    textOut(`- default relay ${out?.config?.defaultRelay ?? DEFAULT_MIND_RELAY_NAME}`);
    const defaultSource = out?.config?.relays?.[out?.config?.defaultRelay]?.source
      || out?.config?.source
      || backendChoiceKey(out?.config?.backend ?? "");
    textOut(`- default source ${defaultSource}`);
    if (runTestNow) {
      textOut(`mind test ${out?.live?.ok ? "passed" : "failed"}`);
      for (const check of out?.live?.checks || []) {
        textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
      }
    }
    if (print) {
      textOut("");
      textOut("planned blocks:");
      for (const w of lastPlan?.writes || []) {
        textOut(`## ${w.path}`);
        textOut(renderShortPreview(w.nextText));
      }
    }
  };
}
