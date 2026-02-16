import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

function unquotePyashText(value) {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const inner = text.slice(1, -1);
  return inner
    .replace(/\\\\/g, "\\")
    .replace(/\\\"/g, "\"");
}

function parseManagedTextField(text, fieldName, { escapeRegex }) {
  const pattern = new RegExp(`su name ${escapeRegex(fieldName)}\\s+ob text\\s+("(?:[^"\\\\]|\\\\.)*")`, "m");
  const match = String(text || "").match(pattern);
  if (!match) return "";
  return unquotePyashText(match[1]);
}

function parseManagedNumField(text, fieldName, { escapeRegex }) {
  const pattern = new RegExp(`su name ${escapeRegex(fieldName)}\\s+ob num\\s+([0-9]+(?:\\.[0-9]+)?)`, "m");
  const match = String(text || "").match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function createConfigureAgentHelpers(deps) {
  const {
    readText,
    pathExists,
    resolveConfiguredAgentHouse,
    parseMapBlock,
    blockMarkers,
    extractManagedBlock,
    MATRIX_POLICY_BLOCK_NAME,
    normalizeIntervalMinutes,
    canonicalizeMindBackend,
    DEFAULT_CHANNEL_AGENT_NAME,
    MIND_BACKEND_CHOICES,
    findMindBackendChoice,
    resolveMindBackendSource,
    resolveMindBackendSelection,
    backendChoiceKey,
    relayMatchesBackendSource,
    formatNumberedRows,
    resolveModelSelection,
    sectionPrinter,
    loadMatrixConfigureDefaults,
    listAgents,
    parseArgValue,
    parseTruthy,
    textOut,
    escapeRegex
  } = deps;

  async function loadAgentDefaults({ worldRoot, agentName }) {
    const normalizedAgentName = String(agentName || "").trim();
    const houseRoot = resolveConfiguredAgentHouse(worldRoot, normalizedAgentName);
    let exists = true;
    try {
      const stat = await fs.stat(houseRoot);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }

    const runtimePath = path.join(houseRoot, "conduct", "runtime.pya");
    const managedPath = path.join(houseRoot, "conduct", "managed.pya");
    const channelPath = path.join(houseRoot, "conduct", "channels.pya");
    const runtimeText = await readText(runtimePath);
    const runtimeBlock = extractManagedBlock(runtimeText, "agent runtime");
    const runtimeValues = parseMapBlock(runtimeBlock);
    const managedText = await readText(managedPath);
    const channelText = await readText(channelPath);
    const channelMarkers = blockMarkers(MATRIX_POLICY_BLOCK_NAME);
    const bindChannel = channelText.includes(channelMarkers.start);

    return {
      exists,
      agentName: normalizedAgentName,
      purpose: parseManagedTextField(managedText, "managed purpose", { escapeRegex }) || "",
      intervalMinutes: normalizeIntervalMinutes(parseManagedNumField(managedText, "managed interval minutes", { escapeRegex }), 24),
      backend: canonicalizeMindBackend(runtimeValues.backend || ""),
      model: String(runtimeValues.model || "").trim(),
      toolsMap: String(runtimeValues["tools map"] || "").trim() || "tools",
      bindChannel
    };
  }

  async function listConfiguredAgents({ worldRoot }) {
    const names = await listAgents({ worldRoot });
    const configuredNames = [];
    for (const agentName of names) {
      const conductDir = path.join(resolveConfiguredAgentHouse(worldRoot, agentName), "conduct");
      const markerPaths = [
        path.join(conductDir, "managed.pya"),
        path.join(conductDir, "runtime.pya"),
        path.join(conductDir, "channels.pya")
      ];
      let configured = false;
      for (const markerPath of markerPaths) {
        if (await pathExists(markerPath)) {
          configured = true;
          break;
        }
      }
      if (configured) configuredNames.push(agentName);
    }
    const items = await Promise.all(configuredNames.map(async (agentName) => await loadAgentDefaults({ worldRoot, agentName })));
    return items.sort((a, b) => a.agentName.localeCompare(b.agentName, "en"));
  }

  async function promptExistingAgent({ worldRoot, title = "Agent", actionLabel = "use" }) {
    const items = await listConfiguredAgents({ worldRoot });
    if (!items.length) return "";
    textOut(`[${title}]`);
    textOut(`Choose agent to ${actionLabel}:`);
    for (const line of formatNumberedRows(items.map((item) => item.agentName), { columns: 1 })) {
      textOut(`  ${line}`);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const fallback = items[0].agentName;
      while (true) {
        const input = String(await rl.question(`Agent (name or number) [${fallback}]: `)).trim();
        const selected = resolveModelSelection(input, { fallback, models: items.map((item) => item.agentName) });
        if (items.some((item) => item.agentName === selected)) return selected;
        textOut("- unknown agent; choose from the listed names or numbers.");
      }
    } finally {
      rl.close();
    }
  }

  function collectAgentFromFlags({ args, mindDefaults = {}, agentDefaults = {} }) {
    let defaultBackend = canonicalizeMindBackend(agentDefaults.backend || mindDefaults.backend || "ollama command mind");
    let defaultModel = String(agentDefaults.model || mindDefaults.model || "gpt-oss:latest").trim();
    const relays = mindDefaults?.relays ?? {};
    const relayNames = Object.keys(relays).sort((a, b) => a.localeCompare(b, "en"));
    const relayInput = String(parseArgValue(args, "--relay") ?? "").trim();
    const relayFallback = relayNames.includes(String(mindDefaults?.defaultRelay || "").trim())
      ? String(mindDefaults.defaultRelay).trim()
      : (relayNames[0] || "");
    let relayName = "";
    if (relayInput) {
      const selectedRelayName = resolveModelSelection(relayInput, { fallback: relayFallback, models: relayNames });
      const selectedRelay = relays[selectedRelayName];
      if (!selectedRelay) throw new Error(`unknown relay: ${relayInput}`);
      relayName = selectedRelayName;
      defaultBackend = canonicalizeMindBackend(selectedRelay.backend || defaultBackend);
      defaultModel = String(selectedRelay.model || defaultModel).trim();
    }
    return {
      agentName: String(parseArgValue(args, "--agent") ?? agentDefaults.agentName ?? DEFAULT_CHANNEL_AGENT_NAME).trim(),
      relayName,
      purpose: String(parseArgValue(args, "--purpose") ?? agentDefaults.purpose ?? "Assist with scheduled automation tasks.").trim(),
      intervalMinutes: normalizeIntervalMinutes(parseArgValue(args, "--interval-minutes") ?? agentDefaults.intervalMinutes ?? 24, 24),
      backend: canonicalizeMindBackend(parseArgValue(args, "--backend") ?? defaultBackend),
      model: String(parseArgValue(args, "--model") ?? defaultModel).trim(),
      toolsMap: String(parseArgValue(args, "--tools-map") ?? agentDefaults.toolsMap ?? "tools").trim(),
      bindChannel: parseTruthy(parseArgValue(args, "--bind-channel"), agentDefaults.bindChannel ?? true),
      smokeTest: parseTruthy(parseArgValue(args, "--smoke-test"), true),
      startNow: parseTruthy(parseArgValue(args, "--start-now"), true)
    };
  }

  async function collectAgentInteractive({ rootDir, mindDefaults = {}, agentDefaults = {}, mode = "establish" }) {
    const defaultBackend = canonicalizeMindBackend(agentDefaults.backend || mindDefaults.backend || "ollama command mind");
    const defaultModel = String(agentDefaults.model || mindDefaults.model || "gpt-oss:latest").trim();
    const defaultAgentName = String(agentDefaults.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim();
    const defaultPurpose = String(agentDefaults.purpose || "Assist with scheduled automation tasks.").trim();
    const defaultToolsMap = String(agentDefaults.toolsMap || "tools").trim();
    const defaultInterval = normalizeIntervalMinutes(agentDefaults.intervalMinutes ?? 24, 24);
    const defaultBindChannel = agentDefaults.bindChannel ?? true;
    const relays = mindDefaults?.relays ?? {};
    const relayNames = Object.keys(relays).sort((a, b) => a.localeCompare(b, "en"));
    let relayName = "";

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

      printer.header("A.1 Agent Identity");
      printer.how(mode === "improve" ? "Keep the current name and adjust purpose/runtime as needed." : "Choose a stable name and concise purpose sentence.");
      const agentName = await ask("Agent name", defaultAgentName);
      const purpose = await ask("Agent purpose", defaultPurpose);

      for (const line of formatNumberedRows(MIND_BACKEND_CHOICES.map((item) => `${item.key} (${item.label})`), { columns: 2 })) {
        textOut(`  ${line}`);
      }
      const backendFallback = backendChoiceKey(defaultBackend || "ollama command mind");
      const backendInput = await ask("Backend (name or number)", backendFallback);
      const selectedBackendChoice = findMindBackendChoice(backendInput) ?? findMindBackendChoice(backendFallback);
      const sourceKey = selectedBackendChoice?.key || resolveMindBackendSource(backendInput, defaultBackend || "ollama command mind");
      const backend = resolveMindBackendSelection(backendInput, defaultBackend || "ollama command mind");

      const backendRelayNames = relayNames.filter((name) => relayMatchesBackendSource(relays[name], sourceKey, backend));
      const backendRelayModels = Array.from(new Set(backendRelayNames.map((name) => String(relays[name]?.model || "").trim()).filter(Boolean)));
      const defaultModelForBackend =
        (canonicalizeMindBackend(agentDefaults.backend || "") === canonicalizeMindBackend(backend) && String(agentDefaults.model || "").trim())
        || (backendRelayModels[0] || "")
        || defaultModel;
      const modelInput = await ask("Model (name or number)", defaultModelForBackend);
      const model = resolveModelSelection(modelInput, { fallback: defaultModelForBackend, models: backendRelayModels });
      const matchedRelayName = backendRelayNames.find((name) => String(relays[name]?.model || "").trim() === String(model).trim()) || "";
      relayName = matchedRelayName || relayName;

      const toolsMap = await ask("Tools map", defaultToolsMap);
      const bindChannel = await askYesNo("Bind default channel to this agent", defaultBindChannel);
      if (bindChannel) {
        const matrix = await loadMatrixConfigureDefaults({ rootDir, agentName });
        if (!matrix?.homeserver || !matrix?.room) textOut("- warning: default channel configure missing; binding will be skipped unless channel is configured.");
      }
      const intervalMinutes = normalizeIntervalMinutes(await ask("Interval minutes", String(defaultInterval)), defaultInterval);
      const smokeTest = await askYesNo("Run begin/stop smoke test", true);
      const startNow = await askYesNo("Start agent services now", true);

      return { agentName, relayName, purpose, intervalMinutes, backend, model, toolsMap, bindChannel, smokeTest, startNow };
    } finally {
      rl.close();
    }
  }

  return {
    loadAgentDefaults,
    listConfiguredAgents,
    promptExistingAgent,
    collectAgentFromFlags,
    collectAgentInteractive
  };
}
