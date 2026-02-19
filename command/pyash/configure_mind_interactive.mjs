import readline from "node:readline/promises";
import {
  MIND_BACKEND_CHOICES,
  looksLikeOllamaBackend,
  fetchOllamaModels,
  fetchCodexModels,
  resolveModelSelection,
  resolveReasoningEffortSelection,
  findMindBackendChoice,
  backendChoiceKey,
  resolveMindBackendSource,
  resolveMindBackendSelection,
  displayMindBackendKey,
  formatNumberedRows,
  suggestMindRelayName,
  defaultMindHostForSource,
  defaultMindModelForSource
} from "./mind_backend_helpers.mjs";

async function askContinueWithoutCodexLogin() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = (await rl.question("Continue without completed Codex login [y/N]: ")).trim().toLowerCase();
    return value === "y" || value === "yes";
  } finally {
    rl.close();
  }
}

export function createCollectMindInteractive(deps) {
  const {
    normalizeHomeserver,
    quoteText,
    sectionPrinter,
    textOut,
    DEFAULT_MIND_RELAY_NAME,
    runCodexAccountCommand,
    codexAccountPath
  } = deps;

  return async function collectMindInteractive({ prior, rootDir }) {
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

      const priorRelays = prior?.relays ?? {};
      const relayNames = Object.keys(priorRelays).sort((a, b) => a.localeCompare(b));
      printer.header("A.0 Existing Relays");
      printer.why("This shows what is already configured so you can add or adjust relays without guessing.");
      printer.how("Default relay is listed first, then each configured relay in Pyash-style sentence form.");
      printer.examples("su name local fromstate text \"ollama\" from text \"http://localhost:11434\" as text \"gpt-oss:latest\" be relay ya");
      if (relayNames.length === 0) {
        textOut("su name mind relays ob text \"none configured\" ya");
      } else {
        const defaultRelay = String(prior?.defaultRelay || relayNames[0] || DEFAULT_MIND_RELAY_NAME).trim();
        textOut(`su name default relay ob text ${quoteText(defaultRelay)} ya`);
        for (const name of relayNames) {
          const relay = priorRelays[name] ?? {};
          textOut(
            `su name ${name} fromstate text ${quoteText(displayMindBackendKey(relay.backend, relay.source || ""))} from text ${quoteText(relay.host || "")} as text ${quoteText(relay.model || "")} be relay ya`
          );
        }
      }

      printer.header("A.1 Mind Relay");
      printer.why("Channel and agent responses require a configured mind relay backend.");
      printer.how("Choose a provider by number or short name; Pyash maps it to the full backend command.");
      printer.examples("1 | ollama | openai-api | openai-codex | openrouter");
      textOut("- providers:");
      for (const line of formatNumberedRows(MIND_BACKEND_CHOICES.map((item) => `${item.key} (${item.label})`), { columns: 2 })) {
        textOut(`  ${line}`);
      }
      const backendFallback = backendChoiceKey(prior.backend || "ollama command mind");
      const backendInput = await ask("Mind backend", backendFallback);
      const selectedChoice = findMindBackendChoice(backendInput) ?? findMindBackendChoice(backendFallback);
      const source = selectedChoice?.key || resolveMindBackendSource(backendInput, prior.backend || "ollama command mind");
      const backend = resolveMindBackendSelection(backendInput, prior.backend || "ollama command mind");
      if (selectedChoice?.key === "openai-api") {
        textOut("- auth note: openai-api expects OPENAI_API_KEY in runtime environment.");
      }
      if (selectedChoice?.key === "openai-codex") {
        textOut("- auth note: openai-codex can run Codex OAuth now via codex app-server.");
      }

      printer.header("B.1 Provider Endpoint");
      printer.why("Mind backend uses this host for model calls.");
      printer.how("Use full URL; protocol defaults to https when omitted.");
      const priorSource = resolveMindBackendSource(prior.source ?? prior.backend ?? "ollama", prior.backend ?? "ollama command mind");
      const defaultHost = priorSource === source && prior.host
        ? prior.host
        : defaultMindHostForSource(source);
      const hostExample = source === "openai-api" || source === "openai-codex"
        ? "https://api.openai.com"
        : defaultHost;
      printer.examples(hostExample);
      const host = normalizeHomeserver(await ask("Mind host", defaultHost));

      const discoveredModels = [];
      const codexModelById = new Map();
      let codexBin = "";
      let discoveredDefaultModel = "";
      let codexLogin = false;
      let codexLoginDone = false;
      let codexAuth = null;
      if (looksLikeOllamaBackend(backend)) {
        printer.header("C.1 Ollama Models");
        printer.why("Listing local tags helps choose a valid default model.");
        printer.how("Pyash queries /api/tags on the configured host.");
        printer.examples("gpt-oss:latest");
        const discovered = await fetchOllamaModels(host);
        if (discovered.ok && discovered.models.length > 0) {
          textOut(`- found ${discovered.models.length} model(s):`);
          for (let i = 0; i < discovered.models.length; i += 1) {
            discoveredModels.push(discovered.models[i]);
          }
          for (const line of formatNumberedRows(discoveredModels, { columns: 2 })) {
            textOut(`  ${line}`);
          }
        } else if (discovered.ok) {
          textOut("- no models reported by host");
        } else {
          textOut(`- model listing unavailable (${discovered.error})`);
        }
      } else if (source === "openai-codex") {
        printer.header("C.0 Codex Login");
        printer.why("Codex auth enables model discovery so you can choose from available models.");
        printer.how("Run login now unless you already authenticated this runtime recently.");
        printer.examples("login truth");
        codexBin = String(await ask("Codex binary path (optional)", "")).trim();
        codexLogin = await askYesNo("Run Codex OAuth login now", true);
        if (codexLogin) {
          const codexRun = await runCodexAccountCommand({
            action: "login",
            codexBin,
            cwd: rootDir,
            json: false,
            codexAccountPath
          });
          if (codexRun.code !== 0) {
            textOut("- codex auth failed");
            const continueWithoutLogin = await askContinueWithoutCodexLogin();
            if (!continueWithoutLogin) process.exit(1);
            codexAuth = { ok: false, skipped: true, reason: "login failed and user chose continue" };
          } else {
            textOut("- codex auth passed");
            codexLoginDone = true;
            codexAuth = { ok: true, interactive: true };
          }
        } else {
          codexAuth = { ok: false, skipped: true, reason: "user skipped login" };
        }

        printer.header("C.1 Codex Models");
        printer.why("Listing Codex models lets you choose a valid model id for this relay.");
        printer.how("Pyash calls codex app-server model/list using the current Codex auth state.");
        printer.examples("gpt-5-codex");
        const discovered = await fetchCodexModels({
          rootDir,
          codexBin,
          runCodexAccountCommand,
          codexAccountPath
        });
        if (discovered.ok && discovered.models.length > 0) {
          textOut(`- found ${discovered.models.length} model(s):`);
          const labels = [];
          for (const entry of discovered.models) {
            const id = String(entry?.id ?? "").trim();
            if (!id) continue;
            codexModelById.set(id, entry);
            if (!discoveredDefaultModel && entry?.isDefault) discoveredDefaultModel = id;
            discoveredModels.push(id);
            const displayName = String(entry?.displayName ?? "").trim();
            const defaultMark = entry?.isDefault ? " default" : "";
            const label = displayName ? `${id} (${displayName}${defaultMark ? `,${defaultMark}` : ""})` : `${id}${defaultMark ? ` (${defaultMark.trim()})` : ""}`;
            labels.push(label);
          }
          for (const line of formatNumberedRows(labels, { columns: 1 })) {
            textOut(`  ${line}`);
          }
        } else if (discovered.ok) {
          textOut("- no models reported by codex app-server");
        } else {
          textOut(`- model listing unavailable (${discovered.error})`);
        }
      }

      printer.header("D.1 Default Model");
      printer.why("Used when agent/mind facts do not specify an explicit model.");
      printer.how("Choose from listed models (number) or enter a model/refinery alias.");
      printer.examples(source === "openai-codex" ? "gpt-5-codex" : "gpt-oss:latest");
      const fallbackModel = defaultMindModelForSource(source);
      const priorModel = priorSource === source ? String(prior.model || "").trim() : "";
      const defaultModel = String(priorModel || discoveredDefaultModel || discoveredModels[0] || fallbackModel).trim();
      const modelInput = await ask("Mind model (name or number)", defaultModel);
      const model = resolveModelSelection(modelInput, { fallback: defaultModel, models: discoveredModels });
      textOut(`- selected model ${model}`);
      let reasoningEffort = "";
      if (source === "openai-codex") {
        const selectedModelInfo = codexModelById.get(model) ?? null;
        const optionsRaw = Array.isArray(selectedModelInfo?.reasoningEffort)
          ? selectedModelInfo.reasoningEffort
          : [];
        const options = Array.from(new Set(optionsRaw.map((item) => String(item ?? "").trim()).filter(Boolean)));
        if (options.length > 0) {
          printer.header("D.2 Reasoning Effort");
          printer.why("Some Codex models expose reasoning levels as submodel controls.");
          printer.how("Choose one of the listed levels by number or name.");
          printer.examples(options.join(" | "));
          textOut("- reasoning levels:");
          for (const line of formatNumberedRows(options, { columns: 2 })) {
            textOut(`  ${line}`);
          }
          const defaultReasoningEffort = String(
            selectedModelInfo?.defaultReasoningEffort
            || (priorSource === source ? prior.reasoningEffort : "")
            || options[0]
          ).trim();
          const reasoningInput = await ask("Reasoning effort (name or number)", defaultReasoningEffort);
          reasoningEffort = resolveReasoningEffortSelection(reasoningInput, {
            fallback: defaultReasoningEffort,
            options
          });
          textOut(`- selected reasoning effort ${reasoningEffort}`);
        }
      }
      printer.header("E.1 Relay Name");
      printer.why("Relay names let you store multiple mind sources and select one as default.");
      printer.how("Use a short stable name; suggestion is based on selected source and model.");
      printer.examples("default | codex gpt 5 | local ollama");
      const suggestedRelayName = suggestMindRelayName({
        source,
        model,
        fallback: prior.defaultRelay || DEFAULT_MIND_RELAY_NAME
      });
      textOut(`- suggested relay name ${suggestedRelayName}`);
      const relayName = String(await ask("Relay name", suggestedRelayName)).trim();
      const setDefaultFallback = !prior.defaultRelay || relayName === prior.defaultRelay;
      const setDefault = await askYesNo("Set this relay as default", setDefaultFallback);

      return {
        relayName,
        setDefault,
        source,
        backend,
        host,
        model,
        reasoningEffort,
        codexLogin,
        codexLoginDone,
        codexAuth,
        codexBin
      };
    } finally {
      rl.close();
    }
  };
}
