#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import {
  beginAgent,
  ensureBaseHouseTemplate,
  establishAgent,
  improveAgent,
  listAgents,
  restartAgent,
  stopAgent
} from "../program/agent/admin.mjs";

function usage() {
  return [
    "Usage: node command/agent_admin.mjs --action <establish|establish-interactive|list|improve|begin|stop|restart|ensure-base> [options]",
    "",
    "Options:",
    "  --world-root <path>      World root (default: ./world)",
    "  --agent <name>           Agent name (required for establish/improve/begin/stop/restart)",
    "  --purpose <text>         Purpose text (establish/improve)",
    "  --note <text>            Improve note (improve)",
    "  --interval-minutes <n>   Heartbeat interval for establish (default: 24)",
    "  --include-base           Include base house in list output",
    "  --no-scheduler-start     Do not auto-start scheduler on begin/restart"
  ].join("\n");
}

function parseArgValue(flag) {
  const idx = process.argv.findIndex((arg) => arg === flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function run() {
  const action = parseArgValue("--action");
  if (!action) {
    console.error(usage());
    process.exit(1);
  }
  const worldRoot = path.resolve(parseArgValue("--world-root") ?? "world");
  const agentName = parseArgValue("--agent");
  const purpose = parseArgValue("--purpose") ?? "";
  const note = parseArgValue("--note") ?? "";
  const intervalMinutesRaw = parseArgValue("--interval-minutes");
  const intervalMinutes = intervalMinutesRaw ? Number(intervalMinutesRaw) : 24;
  const includeBase = hasFlag("--include-base");
  const startScheduler = !hasFlag("--no-scheduler-start");

  if ((action === "establish" || action === "improve" || action === "begin" || action === "stop" || action === "restart")
    && !agentName) {
    throw new Error(`--agent is required for action=${action}`);
  }

  if (action === "establish" && !purpose) {
    throw new Error("--purpose is required for action=establish");
  }

  let result = null;
  if (action === "ensure-base") {
    result = await ensureBaseHouseTemplate({ worldRoot });
  } else if (action === "establish-interactive") {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    try {
      const askedAgent = agentName ?? (await rl.question("agent name: ")).trim();
      if (!askedAgent) throw new Error("agent name is required");
      const askedPurpose = purpose || (await rl.question("agent purpose: ")).trim();
      if (!askedPurpose) throw new Error("agent purpose is required");
      const intervalAnswer = intervalMinutesRaw ?? (await rl.question("interval minutes [24]: ")).trim();
      const interval = intervalAnswer ? Number(intervalAnswer) : 24;
      const beginAnswer = (await rl.question("begin now? [y/N]: ")).trim().toLowerCase();
      result = await establishAgent({
        worldRoot,
        agentName: askedAgent,
        purpose: askedPurpose,
        intervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : 24
      });
      if (beginAnswer === "y" || beginAnswer === "yes") {
        const beginResult = await beginAgent({ worldRoot, agentName: askedAgent, startScheduler });
        result = { ...result, begin: beginResult };
      }
    } finally {
      rl.close();
    }
  } else if (action === "list") {
    result = { action: "list", worldRoot, agents: await listAgents({ worldRoot, includeBase }) };
  } else if (action === "establish") {
    result = await establishAgent({ worldRoot, agentName, purpose, intervalMinutes });
  } else if (action === "improve") {
    result = await improveAgent({ worldRoot, agentName, purpose, note });
  } else if (action === "begin") {
    result = await beginAgent({ worldRoot, agentName, startScheduler });
  } else if (action === "stop") {
    result = await stopAgent({ worldRoot, agentName });
  } else if (action === "restart") {
    result = await restartAgent({ worldRoot, agentName, startScheduler });
  } else {
    throw new Error(`unknown action: ${action}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
