import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { createConfigureAgentHelpers } from "./configure_agent_helpers.mjs";

export function createConfigureAgentCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    parseTruthy,
    readText,
    pathExists,
    resolveConfiguredAgentHouse,
    isEphemeralRootDir,
    loadMindConfigFromSecret,
    loadMatrixConfigureDefaults,
    parseMapBlock,
    blockMarkers,
    escapeRegex,
    extractManagedBlock,
    normalizeIntervalMinutes,
    canonicalizeMindBackend,
    DEFAULT_CHANNEL_AGENT_NAME,
    MATRIX_POLICY_BLOCK_NAME,
    MIND_BACKEND_CHOICES,
    findMindBackendChoice,
    resolveMindBackendSource,
    resolveMindBackendSelection,
    backendChoiceKey,
    displayMindBackendKey,
    relayMatchesBackendSource,
    formatNumberedRows,
    resolveModelSelection,
    sectionPrinter,
    establishAgent,
    beginAgent,
    stopAgent,
    listAgents,
    upsertAgentRuntime,
    upsertAgentDirectoryLicense,
    bindAgentToDefaultChannel,
    upsertAgentChannelSchedule,
    bootstrapAgentMatrixChannelConnection,
    renderShortPreview,
    quoteText,
    jsonOut,
    textOut
  } = deps;

  const helpers = createConfigureAgentHelpers({
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
  });

  async function configureAgentList({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const agents = await helpers.listConfiguredAgents({ worldRoot });
    const out = { ok: true, route: "configure agent list", rootDir, worldRoot, count: agents.length, agents };
    if (json) return void jsonOut(out);
    textOut("configure agent list complete");
    if (!agents.length) return void textOut("- no agents configured");
    textOut(`- agents ${agents.length}`);
    for (const item of agents) {
      textOut(`  su name ${item.agentName} fromstate text ${quoteText(displayMindBackendKey(item.backend))} as text ${quoteText(item.model)} be relay ya`);
    }
  }

  async function configureAgentDelete({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const nonInteractive = hasFlag(args, "--non-interactive");
    let agentName = String(parseArgValue(args, "--agent") || "").trim();
    if (!agentName && !nonInteractive) {
      agentName = await helpers.promptExistingAgent({ worldRoot, title: "A.1 Agent Delete", actionLabel: "delete" });
      if (!agentName) {
        const out = { ok: true, route: "configure agent delete", rootDir, worldRoot, changed: false, skipped: "no agents configured" };
        if (json) jsonOut(out);
        else { textOut("configure agent delete complete"); textOut("- no agents configured"); }
        return;
      }
    }
    if (!agentName) throw new Error("configure agent delete requires --agent");
    if (agentName === "base") throw new Error("configure agent delete cannot remove base");

    let confirmed = parseTruthy(parseArgValue(args, "--yes"), false);
    if (!nonInteractive) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const raw = String(await rl.question(`Delete agent ${agentName} [y/N]: `)).trim().toLowerCase();
        confirmed = raw === "y" || raw === "yes";
      } finally { rl.close(); }
    }

    const housePath = resolveConfiguredAgentHouse(worldRoot, agentName);
    const existed = await fs.stat(housePath).then((s) => s.isDirectory()).catch(() => false);
    if (!confirmed || !existed) {
      const out = { ok: true, route: "configure agent delete", rootDir, worldRoot, changed: false, agentName, existed, confirmed };
      if (json) return void jsonOut(out);
      textOut("configure agent delete complete");
      if (!confirmed) textOut("- no changes made");
      if (!existed) textOut(`- agent ${agentName} not found`);
      return;
    }

    const stopResult = await stopAgent({ worldRoot, agentName }).catch(() => ({ disabledServices: [] }));
    await fs.rm(housePath, { recursive: true, force: true });
    const out = { ok: true, route: "configure agent delete", rootDir, worldRoot, changed: true, agentName, removedPath: housePath, disabledServices: stopResult.disabledServices ?? [] };
    if (json) return void jsonOut(out);
    textOut("configure agent delete complete");
    textOut(`- agent ${agentName}`);
    textOut("- removed house");
  }

  async function configureAgentApply({ args, mode = "establish" }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const print = hasFlag(args, "--print");
    const dryRun = hasFlag(args, "--dry-run");
    const nonInteractive = hasFlag(args, "--non-interactive");
    const mindDefaults = await loadMindConfigFromSecret(rootDir);

    let agentDefaults = {};
    if (mode === "improve") {
      let targetAgent = String(parseArgValue(args, "--agent") || "").trim();
      if (!targetAgent && !nonInteractive) {
        targetAgent = await helpers.promptExistingAgent({ worldRoot, title: "A.0 Existing Agents", actionLabel: "improve" });
        if (!targetAgent) throw new Error("no agents configured to improve");
      }
      if (!targetAgent) throw new Error("configure agent improve requires --agent");
      agentDefaults = await helpers.loadAgentDefaults({ worldRoot, agentName: targetAgent });
      if (!agentDefaults.exists) throw new Error(`agent not found: ${targetAgent}`);
    }

    let cfg = nonInteractive
      ? helpers.collectAgentFromFlags({ args, mindDefaults, agentDefaults })
      : await helpers.collectAgentInteractive({ rootDir, mindDefaults, agentDefaults, mode });
    if (isEphemeralRootDir(rootDir) && parseArgValue(args, "--start-now") == null) cfg = { ...cfg, startNow: false };

    if (!cfg.agentName) throw new Error("configure agent requires --agent");
    if (!cfg.backend || !cfg.model) throw new Error("configure agent requires backend and model");

    let establishResult = { status: "dry-run", changed: false, changes: [] };
    if (!dryRun) establishResult = await establishAgent({ worldRoot, agentName: cfg.agentName, purpose: cfg.purpose, intervalMinutes: cfg.intervalMinutes, writePolicy: false });

    const runtimeWrite = await upsertAgentRuntime({ worldRoot, agentName: cfg.agentName, backend: cfg.backend, model: cfg.model, toolsMap: cfg.toolsMap, dryRun });
    const directoryLicenseWrite = await upsertAgentDirectoryLicense({ rootDir, worldRoot, agentName: cfg.agentName, dryRun });
    const channelWrite = cfg.bindChannel ? await bindAgentToDefaultChannel({ rootDir, worldRoot, agentName: cfg.agentName, dryRun }) : { ok: false, reason: "channel binding disabled", path: null, changed: false, action: "none" };
    const channelScheduleWrite = (cfg.bindChannel && channelWrite.ok)
      ? (channelWrite.mode === "appservice-push" ? { ok: false, reason: "channel schedule skipped (appservice-push uses global channel input)", path: null, changed: false, action: "none" } : await upsertAgentChannelSchedule({ worldRoot, agentName: cfg.agentName, channelType: "matrix", intervalMinutes: 1, dryRun }))
      : { ok: false, reason: "channel schedule skipped", path: null, changed: false, action: "none" };
    const channelBootstrap = (!dryRun && cfg.bindChannel && channelWrite.ok && cfg.startNow)
      ? await bootstrapAgentMatrixChannelConnection({ rootDir, worldRoot, agentName: cfg.agentName })
      : { ok: false, skipped: true, reason: (!cfg.bindChannel || !channelWrite.ok) ? "channel bootstrap skipped" : "start skipped" };

    let smoke = null;
    let activation = null;
    if (cfg.smokeTest && !dryRun) {
      const beginRes = await beginAgent({ worldRoot, agentName: cfg.agentName, startScheduler: false });
      const stopRes = await stopAgent({ worldRoot, agentName: cfg.agentName });
      smoke = { ok: true, begin: beginRes.enabledServices ?? [], stop: stopRes.disabledServices ?? [] };
    }
    if (!dryRun && cfg.startNow) {
      const beginRes = await beginAgent({ worldRoot, agentName: cfg.agentName, startScheduler: true });
      activation = { ok: true, enabled: beginRes.enabledServices ?? [] };
    } else if (!dryRun) {
      activation = { ok: true, enabled: [], note: "start skipped" };
    }

    const out = {
      ok: true,
      route: "configure agent",
      action: mode,
      rootDir,
      worldRoot,
      dryRun,
      changed: Boolean(establishResult.changed || runtimeWrite.changed || directoryLicenseWrite.changed || channelWrite.changed || channelScheduleWrite.changed),
      config: { agentName: cfg.agentName, relayName: cfg.relayName || "", intervalMinutes: cfg.intervalMinutes, backend: cfg.backend, model: cfg.model, toolsMap: cfg.toolsMap, bindChannel: cfg.bindChannel, smokeTest: cfg.smokeTest, startNow: cfg.startNow },
      establish: { status: establishResult.status, changed: establishResult.changed, changes: establishResult.changes },
      runtimeWrite,
      directoryLicenseWrite,
      channelWrite,
      channelScheduleWrite,
      channelBootstrap,
      smoke,
      activation
    };
    if (json) return void jsonOut(out);

    textOut(`configure agent ${mode} complete`);
    textOut(`- agent ${cfg.agentName}`);
    textOut(`- establish ${establishResult.status}`);
    textOut(`- runtime ${runtimeWrite.path} (${runtimeWrite.changed ? "changed" : "unchanged"})`);
    textOut(`- directory license ${directoryLicenseWrite.path} (${directoryLicenseWrite.changed ? "changed" : "unchanged"})`);
    if (cfg.bindChannel && channelWrite.ok) textOut(`- channel ${channelWrite.path} (${channelWrite.changed ? "changed" : "unchanged"})`);
    if (smoke) textOut(`- smoke test passed (begin=${smoke.begin.length} stop=${smoke.stop.length})`);
    if (activation?.ok) textOut(`- start now enabled services ${activation.enabled.length}`);
    if (print) {
      const runtimePath = path.join(resolveConfiguredAgentHouse(worldRoot, cfg.agentName), "conduct", "runtime.pya");
      const runtimeText = await readText(runtimePath);
      if (runtimeText) {
        textOut("");
        textOut(`## ${runtimePath}`);
        textOut(renderShortPreview(runtimeText));
      }
    }
  }

  return async function configureAgent({ args }) {
    const sub = String(args[0] || "");
    const hasSub = sub && !sub.startsWith("--");
    if (hasSub) {
      if (sub === "list") return await configureAgentList({ args: args.slice(1) });
      if (sub === "establish") return await configureAgentApply({ args: args.slice(1), mode: "establish" });
      if (sub === "improve") return await configureAgentApply({ args: args.slice(1), mode: "improve" });
      if (sub === "delete") return await configureAgentDelete({ args: args.slice(1) });
      throw new Error(`unknown configure agent action: ${sub}`);
    }
    if (hasFlag(args, "--non-interactive")) return await configureAgentApply({ args, mode: "establish" });

    while (true) {
      let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        textOut("Pyash Configure Agent");
        textOut("1. list");
        textOut("2. establish");
        textOut("3. improve");
        textOut("4. delete");
        textOut("5. exit");
        const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
        if (choice === "1") {
          rl.close(); rl = null; await configureAgentList({ args: [] }); continue;
        }
        if (choice === "2") {
          rl.close(); rl = null; await configureAgentApply({ args: [], mode: "establish" }); continue;
        }
        if (choice === "3") {
          rl.close(); rl = null; await configureAgentApply({ args: [], mode: "improve" }); continue;
        }
        if (choice === "4") {
          rl.close(); rl = null; await configureAgentDelete({ args: [] }); continue;
        }
        textOut("No changes made.");
        return;
      } finally {
        try { rl?.close(); } catch {}
      }
    }
  };
}
