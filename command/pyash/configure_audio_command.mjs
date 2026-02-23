import path from "node:path";
import readline from "node:readline/promises";

function normalizeBackend(raw, fallback = "whisper") {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "whisperx") return "whisperx";
  if (value === "whisper") return "whisper";
  return fallback;
}

function normalizeHost(raw, fallback = "http://whisperx:8000") {
  const value = String(raw ?? "").trim();
  return value || fallback;
}

function normalizeModel(raw, fallback = "large-v3") {
  const value = String(raw ?? "").trim();
  return value || fallback;
}

function collectAudioFromFlags({ args, prior, parseArgValue, parseTruthy }) {
  const backend = normalizeBackend(parseArgValue(args, "--backend") ?? prior.backend ?? "whisper");
  const whisperxEnabled = parseTruthy(parseArgValue(args, "--whisperx-enabled"), backend === "whisperx" || parseTruthy(prior.whisperxEnabled, false));
  return {
    backend,
    whisperxEnabled,
    host: normalizeHost(parseArgValue(args, "--host") ?? prior.host ?? "http://whisperx:8000"),
    model: normalizeModel(parseArgValue(args, "--model") ?? prior.model ?? "large-v3")
  };
}

async function collectAudioInteractive({ prior, textOut }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = false) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    textOut("Audio Configure");
    const backend = normalizeBackend(await ask("Hear backend (whisper|whisperx)", prior.backend || "whisper"));
    const whisperxEnabled = await askYesNo("Enable whisperx service on begin", backend === "whisperx" || String(prior.whisperxEnabled).toLowerCase() === "truth");
    const host = normalizeHost(await ask("WhisperX host", prior.host || "http://whisperx:8000"));
    const model = normalizeModel(await ask("WhisperX model", prior.model || "large-v3"));
    return { backend, whisperxEnabled, host, model };
  } finally {
    rl.close();
  }
}

function audioVerification(cfg) {
  const errors = [];
  if (cfg.backend !== "whisper" && cfg.backend !== "whisperx") {
    errors.push({ code: "invalid_backend", message: "backend must be whisper or whisperx" });
  }
  if (!String(cfg.host ?? "").trim()) {
    errors.push({ code: "missing_host", message: "host is required" });
  }
  if (!String(cfg.model ?? "").trim()) {
    errors.push({ code: "missing_model", message: "model is required" });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

function buildAudioConfigureBlock(cfg, quote) {
  return [
    "su name audio configure be map def",
    `  su name hear backend default ob text ${quote(cfg.backend)} ya`,
    `  su name whisperx enabled ob bool ${cfg.whisperxEnabled ? "truth" : "lie"} ya`,
    `  su name hear host ob text ${quote(cfg.host)} ya`,
    `  su name hear whisperx model ob text ${quote(cfg.model)} ya`,
    "prah",
    `exists su name hear backend default ob text ${quote(cfg.backend)} be default ya`,
    `exists su name whisperx enabled ob bool ${cfg.whisperxEnabled ? "truth" : "lie"} be default ya`,
    `exists su name hear host ob text ${quote(cfg.host)} be default ya`,
    `exists su name hear whisperx model ob text ${quote(cfg.model)} be default ya`
  ].join("\n");
}

export function createConfigureAudioCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    parseTruthy,
    readText,
    parseMapBlock,
    extractManagedBlock,
    planManagedUpsert,
    applyWritePlan,
    writePlanSummary,
    renderShortPreview,
    quoteText,
    jsonOut,
    textOut
  } = deps;

  const AUDIO_CONFIG_BLOCK_NAME = "audio configure";

  async function loadAudioConfigFromSecret(rootDir) {
    const secretPath = path.join(rootDir, "configure", "secret.pya");
    const text = await readText(secretPath);
    if (!text) return {};
    const block = extractManagedBlock(text, AUDIO_CONFIG_BLOCK_NAME);
    const values = parseMapBlock(block);
    return {
      backend: values["hear backend default"] || "",
      whisperxEnabled: values["whisperx enabled"] || "",
      host: values["hear host"] || "",
      model: values["hear whisperx model"] || ""
    };
  }

  return async function configureAudio({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const json = hasFlag(args, "--json");
    const print = hasFlag(args, "--print");
    const dryRun = hasFlag(args, "--dry-run");
    const nonInteractive = hasFlag(args, "--non-interactive");
    const prior = await loadAudioConfigFromSecret(rootDir);

    const cfg = nonInteractive
      ? collectAudioFromFlags({ args, prior, parseArgValue, parseTruthy })
      : await collectAudioInteractive({ prior, textOut });

    const verification = audioVerification(cfg);
    if (!verification.ok) {
      const out = { ok: false, stage: "verification", verification, config: cfg };
      if (json) jsonOut(out);
      else {
        textOut("verification failed:");
        for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
      }
      process.exit(1);
    }

    const secretPath = path.join(rootDir, "configure", "secret.pya");
    const secretExisting = await readText(secretPath);
    const plan = planManagedUpsert({
      existing: secretExisting,
      blockName: AUDIO_CONFIG_BLOCK_NAME,
      content: buildAudioConfigureBlock(cfg, quoteText)
    });
    const writePlan = {
      writes: [{
        path: secretPath,
        changed: plan.changed,
        action: plan.action,
        preview: [AUDIO_CONFIG_BLOCK_NAME],
        nextText: plan.nextText
      }],
      changed: plan.changed
    };
    if (!dryRun) await applyWritePlan(writePlan);

    const out = {
      ok: true,
      route: "configure audio",
      rootDir,
      dryRun,
      changed: writePlan.changed,
      writes: writePlanSummary(writePlan),
      verification,
      config: cfg
    };
    if (json) return void jsonOut(out);
    textOut("configure audio complete");
    for (const w of out.writes) textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
    if (print) {
      textOut("");
      textOut("planned blocks:");
      for (const w of writePlan.writes) {
        textOut(`## ${w.path}`);
        textOut(renderShortPreview(w.nextText));
      }
    }
  };
}
