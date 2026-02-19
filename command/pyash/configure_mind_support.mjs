import {
  canonicalizeMindBackend,
  looksLikeOllamaBackend,
  fetchOllamaModels,
  backendChoiceKey,
  resolveMindBackendSource,
  defaultMindHostForSource,
  defaultMindModelForSource
} from "./mind_backend_helpers.mjs";
import { createCollectMindInteractive } from "./configure_mind_interactive.mjs";

export function createConfigureMindSupport(deps) {
  const {
    parseArgValue,
    parseTruthy,
    normalizeHomeserver,
    quoteText,
    sectionPrinter,
    textOut,
    DEFAULT_MIND_RELAY_NAME,
    runCodexAccountCommand,
    codexAccountPath
  } = deps;

  const collectMindInteractive = createCollectMindInteractive({
    normalizeHomeserver,
    quoteText,
    sectionPrinter,
    textOut,
    DEFAULT_MIND_RELAY_NAME,
    runCodexAccountCommand,
    codexAccountPath
  });

  function collectMindFromFlags({ args, prior }) {
    const backendInput = parseArgValue(args, "--backend") ?? prior.source ?? prior.backend ?? "ollama";
    const source = resolveMindBackendSource(backendInput, prior.backend ?? "ollama command mind");
    const backend = canonicalizeMindBackend(backendInput ?? prior.backend ?? "ollama command mind");
    const priorSource = resolveMindBackendSource(prior.source ?? prior.backend ?? "ollama", prior.backend ?? "ollama command mind");
    const defaultHost = defaultMindHostForSource(source);
    const defaultModel = defaultMindModelForSource(source);
    const hostFallback = priorSource === source && prior.host ? prior.host : defaultHost;
    const modelFallback = priorSource === source && prior.model ? prior.model : defaultModel;
    const reasoningFallback = priorSource === source ? String(prior.reasoningEffort || "").trim() : "";
    const relayName = String(parseArgValue(args, "--relay") ?? prior.defaultRelay ?? DEFAULT_MIND_RELAY_NAME).trim();
    const setDefaultRaw = parseArgValue(args, "--set-default");
    const setDefault = setDefaultRaw == null
      ? (!prior.defaultRelay || relayName === prior.defaultRelay)
      : parseTruthy(setDefaultRaw, true);
    const codexLogin = source === "openai-codex"
      ? parseTruthy(parseArgValue(args, "--codex-login"), false)
      : false;
    const codexBin = String(parseArgValue(args, "--codex-bin") ?? "").trim();
    return {
      relayName,
      setDefault,
      source,
      backend,
      host: normalizeHomeserver(parseArgValue(args, "--host") ?? hostFallback),
      model: String(parseArgValue(args, "--model") ?? modelFallback).trim(),
      reasoningEffort: String(parseArgValue(args, "--reasoning-effort") ?? reasoningFallback).trim(),
      codexLogin,
      codexBin
    };
  }

  function mindVerification(cfg) {
    const errors = [];
    if (!String(cfg.relayName ?? "").trim()) errors.push({ code: "missing_relay", message: "relay is required" });
    if (!String(cfg.source ?? "").trim()) errors.push({ code: "missing_source", message: "source is required" });
    if (!String(cfg.backend ?? "").trim()) errors.push({ code: "missing_backend", message: "backend is required" });
    const host = normalizeHomeserver(cfg.host);
    if (!host) errors.push({ code: "missing_host", message: "host is required" });
    if (!/^https?:\/\//i.test(host)) errors.push({ code: "invalid_host", message: "host must start with http:// or https://" });
    if (!String(cfg.model ?? "").trim()) errors.push({ code: "missing_model", message: "model is required" });
    return { ok: errors.length === 0, errors, warnings: [] };
  }

  async function mindLiveTest(cfg) {
    const backend = canonicalizeMindBackend(cfg.backend);
    const checks = [];
    if (looksLikeOllamaBackend(backend)) {
      const tags = await fetchOllamaModels(cfg.host);
      if (!tags.ok) {
        checks.push({ name: "host reachable", ok: false, error: tags.error });
        return { ok: false, checks };
      }
      checks.push({ name: "host reachable", ok: true });
      checks.push({ name: "models listed", ok: true, count: tags.models.length });
      const selectedModel = String(cfg.model ?? "").trim();
      const available = tags.models.includes(selectedModel);
      checks.push({ name: "model available", ok: available, model: selectedModel });
      if (!available) return { ok: false, checks };
      return { ok: true, checks };
    }
    checks.push({
      name: "provider live check",
      ok: true,
      skipped: true,
      backend,
      reason: "non-ollama backend: host/model saved; run provider-specific smoke test separately"
    });
    return { ok: true, checks };
  }

  function buildMindConfigureBlock(cfg) {
    return [
      "su name mind configure be map def",
      `  su name source ob text ${quoteText(cfg.source || backendChoiceKey(cfg.backend || ""))} ya`,
      `  su name backend ob text ${quoteText(cfg.backend)} ya`,
      `  su name host ob text ${quoteText(cfg.host)} ya`,
      `  su name model ob text ${quoteText(cfg.model)} ya`,
      `  su name reasoning effort ob text ${quoteText(cfg.reasoningEffort || "")} ya`,
      "prah"
    ].join("\n");
  }

  function buildMindRelaysBlock({ relays = {}, defaultRelay = DEFAULT_MIND_RELAY_NAME }) {
    const names = Object.keys(relays).sort((a, b) => a.localeCompare(b));
    const lines = [
      "su name mind relays be map def",
      `  su name default relay ob text ${quoteText(defaultRelay)} ya`
    ];
    for (const relayName of names) {
      const relay = relays[relayName] ?? {};
      lines.push(`  su name relay ${relayName} source ob text ${quoteText(relay.source || backendChoiceKey(relay.backend || ""))} ya`);
      lines.push(`  su name relay ${relayName} backend ob text ${quoteText(relay.backend ?? "")} ya`);
      lines.push(`  su name relay ${relayName} host ob text ${quoteText(relay.host ?? "")} ya`);
      lines.push(`  su name relay ${relayName} model ob text ${quoteText(relay.model ?? "")} ya`);
      lines.push(`  su name relay ${relayName} reasoning effort ob text ${quoteText(relay.reasoningEffort ?? "")} ya`);
    }
    lines.push("prah");
    return lines.join("\n");
  }

  function buildMindDefaultsBlock(cfg, { defaultRelay = DEFAULT_MIND_RELAY_NAME } = {}) {
    return [
      `exists su name mind relay default ob text ${quoteText(defaultRelay)} be default ya`,
      `exists su name mind source ob text ${quoteText(cfg.source || backendChoiceKey(cfg.backend || ""))} be default ya`,
      `exists su name mind backend be default ob name ${cfg.backend} ya`,
      `exists su name ollama host ob text ${quoteText(cfg.host)} be default ya`,
      `exists su name ai host ob text ${quoteText(cfg.host)} be default ya`,
      `exists su name mind model ob text ${quoteText(cfg.model)} be default ya`,
      `exists su name mind reasoning effort ob text ${quoteText(cfg.reasoningEffort || "")} be default ya`
    ].join("\n");
  }

  return {
    collectMindFromFlags,
    collectMindInteractive,
    mindVerification,
    mindLiveTest,
    buildMindConfigureBlock,
    buildMindRelaysBlock,
    buildMindDefaultsBlock
  };
}
