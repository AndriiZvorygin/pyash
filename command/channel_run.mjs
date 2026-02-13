import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveConfigMapText } from "../program/configure/env.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "../program/agent/session.mjs";
import { loadChannelPolicyWithGlobal } from "../program/agent/channels/policy.mjs";
import { runChannelOnce } from "../program/agent/channels/index.mjs";
import { createMatrixAdapter } from "../program/agent/channels/matrix.mjs";
import { loadSchedulePolicyWithGlobal, createScheduler } from "../program/agent/scheduler.mjs";
import { ensureMatrixCredentials, ensureMatrixExecutiveDmRoom } from "../program/agent/channels/bootstrap.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";

function usage() {
  return "Usage: node command/channel_run.mjs --agent <name> --channel <type> [--once]";
}

function readRememberText(name) {
  const fact = remember(name);
  const value = fact?.ob?.text ?? fact?.ob?.name ?? fact?.ob?.filename ?? null;
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function homeserverHost(homeserver) {
  const text = String(homeserver ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).host.toLowerCase();
  } catch {
    return text.replace(/^https?:\/\//i, "").replace(/\/.*$/g, "").toLowerCase();
  }
}

function normalizeMatrixLocalpart(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._=-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeMatrixUserIdentity(raw, homeserver = "") {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const host = homeserverHost(homeserver);
  const withAt = text.startsWith("@") ? text : `@${text}`;
  const lower = withAt.toLowerCase();
  const body = lower.slice(1);
  const idx = body.indexOf(":");
  const localpart = normalizeMatrixLocalpart(idx === -1 ? body : body.slice(0, idx));
  if (!localpart) return "";
  const server = idx === -1 ? host : body.slice(idx + 1).trim().toLowerCase();
  return server ? `@${localpart}:${server}` : `@${localpart}`;
}

function matrixUsersMatch(a, b, homeserver = "") {
  const left = normalizeMatrixUserIdentity(a, homeserver);
  const right = normalizeMatrixUserIdentity(b, homeserver);
  return Boolean(left && right && left === right);
}

function resolveMatrixConfigWithRemember(rawConfig = {}) {
  const mapName = "matrix channel";
  const mapHomeserver = resolveConfigMapText(mapName, "homeserver");
  const mapSharedSecret = resolveConfigMapText(mapName, "registration shared secret");
  const mapAdminToken = resolveConfigMapText(mapName, "admin token");
  const mapToken = resolveConfigMapText(mapName, "token");
  const mapUser = resolveConfigMapText(mapName, "user");
  const mapExecutive = resolveConfigMapText(mapName, "executive username");
  const homeserver =
    rawConfig.homeserver ??
    mapHomeserver ??
    readRememberText("matrix homeserver") ??
    readRememberText("matrix server") ??
    null;
  const user =
    rawConfig.user ??
    mapUser ??
    readRememberText("matrix user") ??
    null;
  const allowGlobalToken = !mapToken
    ? false
    : !mapUser || matrixUsersMatch(user, mapUser, homeserver || "");
  return {
    ...rawConfig,
    homeserver,
    user,
    registrationSharedSecret:
      mapSharedSecret ??
      rawConfig.registrationSharedSecret ??
      readRememberText("matrix registration shared secret") ??
      null,
    adminToken:
      mapAdminToken ??
      rawConfig.adminToken ??
      readRememberText("matrix admin token") ??
      null,
    token:
      rawConfig.token ??
      (allowGlobalToken ? mapToken : null) ??
      null,
    executiveUsername:
      mapExecutive ??
      rawConfig.executiveUsername ??
      readRememberText("matrix executive username") ??
      null
  };
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
    channelConfig = resolveMatrixConfigWithRemember(channelConfig);
    const credentials = await ensureMatrixCredentials({
      agentName,
      agentHouse,
      config: channelConfig
    });
    channelConfig = {
      ...channelConfig,
      homeserver: credentials.homeserver,
      token: credentials.token,
      user: credentials.user || channelConfig.user
    };
    try {
      const executiveRoom = await ensureMatrixExecutiveDmRoom({
        agentHouse,
        homeserver: channelConfig.homeserver,
        token: channelConfig.token,
        user: channelConfig.user,
        executiveUser: channelConfig.executiveUsername
      });
      if (executiveRoom) {
        const hasRoom = Array.isArray(channelConfig.rooms) && channelConfig.rooms.some(room => room?.id === executiveRoom);
        const nextRooms = Array.isArray(channelConfig.rooms) ? [...channelConfig.rooms] : [];
        if (!hasRoom) {
          nextRooms.push({
            id: executiveRoom,
            lane: "matrix_executive_dm"
          });
        }
        const nextDmRooms = new Set(Array.isArray(channelConfig.dmRooms) ? channelConfig.dmRooms : []);
        nextDmRooms.add(executiveRoom);
        channelConfig = {
          ...channelConfig,
          rooms: nextRooms,
          dmRooms: Array.from(nextDmRooms)
        };
      }
    } catch (err) {
      // DM room hydration is best-effort; channel polling should continue for configured rooms.
      console.error(`[matrix executive dm skipped] ${String(err?.message ?? err)}`);
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
