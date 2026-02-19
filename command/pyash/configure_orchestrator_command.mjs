import path from "node:path";
import readline from "node:readline/promises";

function normalizePort(raw, fallback = 59652) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  const whole = Math.floor(num);
  if (whole < 1 || whole > 65535) return fallback;
  return whole;
}

function normalizePositiveInt(raw, fallback = 1) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function collectOrchestratorFromFlags({ args, prior, parseArgValue, parseTruthy }) {
  return {
    mode: String(parseArgValue(args, "--mode") ?? prior.mode ?? "container").trim().toLowerCase(),
    host: String(parseArgValue(args, "--host") ?? prior.host ?? "127.0.0.1").trim(),
    port: normalizePort(parseArgValue(args, "--port") ?? prior.port ?? 59652, 59652),
    autostart: parseTruthy(parseArgValue(args, "--autostart"), parseTruthy(prior.autostart, true)),
    healthMinute: normalizePositiveInt(parseArgValue(args, "--health-rhythm-minute") ?? prior.healthMinute ?? 1, 1)
  };
}

async function collectOrchestratorInteractive({ prior, sectionPrinter, parseTruthy, textOut }) {
  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    printer.header("A.1 Orchestrator Endpoint");
    let mode = "";
    while (!mode) {
      const picked = String(await ask("Mode (container/local)", prior.mode || "container")).trim().toLowerCase();
      if (picked !== "container" && picked !== "local") {
        textOut("- invalid: mode must be container or local");
        continue;
      }
      mode = picked;
    }
    const host = String(await ask("Host", prior.host || "127.0.0.1")).trim() || "127.0.0.1";
    const port = normalizePort(await ask("Port", String(prior.port || 59652)), 59652);

    const autostart = await askYesNo("Autostart services", parseTruthy(prior.autostart, true));
    let healthMinute = normalizePositiveInt(String(prior.healthMinute || 1), 1);
    const showAdvanced = await askYesNo("Show advanced orchestrator options", false);
    if (showAdvanced) {
      healthMinute = normalizePositiveInt(await ask("Health update rhythm (minutes)", String(prior.healthMinute || 1)), 1);
    }

    return { mode, host, port, autostart, healthMinute };
  } finally {
    rl.close();
  }
}

function orchestratorVerification(cfg) {
  const errors = [];
  const mode = String(cfg.mode ?? "").trim().toLowerCase();
  if (mode !== "container" && mode !== "local") {
    errors.push({ code: "invalid_mode", message: "mode must be container or local" });
  }
  if (!String(cfg.host ?? "").trim()) {
    errors.push({ code: "missing_host", message: "host is required" });
  }
  const port = Number(cfg.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    errors.push({ code: "invalid_port", message: "port must be between 1 and 65535" });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

async function createOrchestratorWritePlan({ rootDir, cfg, readText, planManagedUpsert, ORCHESTRATOR_CONFIG_BLOCK_NAME, buildOrchestratorConfigureBlock }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);
  const plan = planManagedUpsert({
    existing: secretExisting,
    blockName: ORCHESTRATOR_CONFIG_BLOCK_NAME,
    content: buildOrchestratorConfigureBlock(cfg)
  });
  return {
    writes: [{
      path: secretPath,
      changed: plan.changed,
      action: plan.action,
      preview: [ORCHESTRATOR_CONFIG_BLOCK_NAME],
      nextText: plan.nextText
    }],
    changed: plan.changed
  };
}

export function createConfigureOrchestratorCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    parseTruthy,
    isEphemeralRootDir,
    loadOrchestratorConfigFromSecret,
    applyWritePlan,
    writePlanSummary,
    schedulerBegin,
    schedulerStop,
    buildOrchestratorConfigureBlock,
    ORCHESTRATOR_CONFIG_BLOCK_NAME,
    readText,
    planManagedUpsert,
    sectionPrinter,
    renderShortPreview,
    jsonOut,
    textOut
  } = deps;

  return async function configureOrchestrator({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const ephemeralRoot = isEphemeralRootDir(rootDir);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const print = hasFlag(args, "--print");
    const dryRun = hasFlag(args, "--dry-run");
    const nonInteractive = hasFlag(args, "--non-interactive");
    const prior = await loadOrchestratorConfigFromSecret(rootDir);
    let cfg = nonInteractive
      ? collectOrchestratorFromFlags({ args, prior, parseArgValue, parseTruthy })
      : await collectOrchestratorInteractive({ prior, sectionPrinter, parseTruthy, textOut });
    if (ephemeralRoot && parseArgValue(args, "--autostart") == null) cfg = { ...cfg, autostart: false };

    const verification = orchestratorVerification(cfg);
    if (!verification.ok) {
      const out = { ok: false, stage: "verification", verification, config: cfg };
      if (json) jsonOut(out);
      else {
        textOut("verification failed:");
        for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
      }
      process.exit(1);
    }

    const plan = await createOrchestratorWritePlan({
      rootDir,
      cfg,
      readText,
      planManagedUpsert,
      ORCHESTRATOR_CONFIG_BLOCK_NAME,
      buildOrchestratorConfigureBlock
    });
    if (!dryRun) await applyWritePlan(plan);
    let runtime = null;
    if (!dryRun) runtime = cfg.autostart ? await schedulerBegin({ worldRoot }) : await schedulerStop({ worldRoot });

    const out = {
      ok: true,
      route: "configure orchestrator",
      rootDir,
      worldRoot,
      dryRun,
      changed: plan.changed,
      writes: writePlanSummary(plan),
      verification,
      runtime,
      config: cfg
    };
    if (json) return void jsonOut(out);
    textOut("configure orchestrator complete");
    for (const w of out.writes) textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
    if (runtime) textOut(`- scheduler ${runtime.running ? "running" : "stopped"}`);
    if (print) {
      textOut("");
      textOut("planned blocks:");
      for (const w of plan.writes) {
        textOut(`## ${w.path}`);
        textOut(renderShortPreview(w.nextText));
      }
    }
  };
}
