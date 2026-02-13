import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "../program/agent/session.mjs";
import { loadChannelPolicyWithGlobal } from "../program/agent/channels/policy.mjs";
import { runChannelOnce } from "../program/agent/channels/index.mjs";
import { createMatrixAdapter } from "../program/agent/channels/matrix.mjs";
import { loadSchedulePolicyWithGlobal, createScheduler } from "../program/agent/scheduler.mjs";
import { hydrateMatrixRuntimeConfig } from "../program/agent/channels/matrix_runtime.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";

function usage() {
  return "Usage: node command/channel_run.mjs --agent <name> --channel <type> [--once]";
}

function selectChannelJobs(jobs, channelType, agentName) {
  const prefixPoll = `${channelType} poll`;
  const prefixProbe = `${channelType} probe`;
  return jobs.filter((job) => {
    if (job.agentName !== agentName) return false;
    const name = job.jobName.toLowerCase();
    return name.startsWith(prefixPoll) || name.startsWith(prefixProbe);
  });
}

async function initializeRuntime({ cwd, agentName }) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) {
    registerSignatureHandler(sig);
  }
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
  if (!remember(agentName)) {
    await interpret(parse(`exists su name ${agentName} be mind ya`));
  }
}

async function ensureWorldChannelSeed(worldRoot) {
  const conductDir = path.join(worldRoot, "conduct");
  const channelsPath = path.join(conductDir, "channels.pya");
  await fs.mkdir(conductDir, { recursive: true });
  try {
    await fs.access(channelsPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    const seed = [
      "su name matrix channel ob bool lie ya"
    ].join("\n") + "\n";
    await fs.writeFile(channelsPath, seed, "utf8");
  }
}

function createAdapter(channelType) {
  if (channelType === "matrix") return createMatrixAdapter();
  throw new Error(`unsupported channel type: ${channelType}`);
}

async function main() {
  const args = process.argv.slice(2);
  const agentName = readFlagValue(args, "--agent") ?? readFlagValue(args, "-a");
  const channelType = (readFlagValue(args, "--channel") ?? "").toLowerCase();
  if (!agentName || !channelType) {
    console.error(usage());
    process.exit(1);
  }
  const once = args.includes("--once");

  await initializeRuntime({ cwd: process.cwd(), agentName });
  const worldRoot = resolveWorldRoot({ rememberFn: remember }) ?? path.resolve(process.cwd(), "world");
  await ensureWorldChannelSeed(worldRoot);
  const agentHouse = resolveAgentHouse({ mindName: agentName, rememberFn: remember });
  await ensureAgentDirs(agentHouse);
  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const rawConfig = allChannels[channelType];
  if (!rawConfig?.enabled) {
    console.error(`channel not enabled: ${channelType}`);
    process.exit(1);
  }
  let channelConfig = { ...rawConfig };
  if (channelType === "matrix") {
    const hydrated = await hydrateMatrixRuntimeConfig({
      channelConfig,
      agentName,
      agentHouse,
      channelType
    });
    channelConfig = hydrated.channelConfig;
    if (hydrated.dmBootstrapErrors.length > 0) {
      const first = hydrated.dmBootstrapErrors[0];
      const executive = String(first?.executiveUser ?? "").trim();
      const detail = String(first?.error ?? "").trim();
      console.error(`[matrix executive dm degraded] count=${hydrated.dmBootstrapErrors.length} first=${executive} ${detail}`);
    }
  }
  const adapter = createAdapter(channelType);
  const runTick = () => runChannelOnce({
    agentName,
    channelType,
    channelConfig,
    adapter,
    interpretFn: interpret,
    agentHouse
  });

  if (once) {
    const result = await runTick();
    console.log(`${channelType}: received=${result.received} handled=${result.handled} sent=${result.sent}`);
    return;
  }

  const jobs = selectChannelJobs(await loadSchedulePolicyWithGlobal({ worldRoot, agentHouse, agentName }), channelType, agentName);
  if (!jobs.length) {
    console.error(`no calendar job configured for ${agentName} ${channelType} poll/probe`);
    process.exit(1);
  }
  const scheduler = createScheduler({
    jobs,
    runJob: async () => {
      const result = await runTick();
      return { status: `received=${result.received} handled=${result.handled} sent=${result.sent}` };
    },
    onError: (err) => {
      console.error(`[channel scheduler error] ${String(err?.message ?? err)}`);
    }
  });
  await scheduler.runNow();
  scheduler.start();
  console.log(`channel runner started: ${channelType} (${jobs.length} job(s))`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
