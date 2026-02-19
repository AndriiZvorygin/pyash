import fs from "node:fs/promises";
import path from "node:path";

function sanitizeLogName(raw, fallback = "log") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function normalizeTailCount(raw, fallback = 80) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(num)));
}

async function readChannelLog({ worldRoot, agentName, channelType, tailCount, readText }) {
  const newspaperDir = path.join(worldRoot, "newspaper");
  const suffix = `-channel-${sanitizeLogName(channelType)}-${sanitizeLogName(agentName)}.pya`;
  const names = await fs.readdir(newspaperDir).catch((err) => {
    if (err?.code === "ENOENT") return [];
    throw err;
  });
  const matches = names
    .filter((name) => name.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b, "en"));
  const fileName = matches[matches.length - 1] || null;
  if (!fileName) {
    return {
      found: false,
      filePath: null,
      totalLines: 0,
      lines: []
    };
  }
  const filePath = path.join(newspaperDir, fileName);
  const text = await readText(filePath);
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return {
    found: true,
    filePath,
    totalLines: lines.length,
    lines: lines.slice(-tailCount)
  };
}

export function createChannelCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    runNodeScript,
    installRoot,
    DEFAULT_CHANNEL_AGENT_NAME,
    normalizeChannelAgentName,
    bootstrapAgentMatrixChannelConnection,
    enqueueCliInbound,
    claimOldestProduceEnvelope,
    ackRuntimeEnvelopeSuccess,
    ackRuntimeEnvelopeFail,
    readText,
    jsonOut,
    textOut
  } = deps;

  async function channelPollCommand(args) {
    const rootDir = await resolveRootDirFromArgs(args);
    const json = hasFlag(args, "--json");
    const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
    const channelType = parseArgValue(args, "--channel") ?? "matrix";
    const runArgs = [
      "--agent", agentName,
      "--channel", channelType,
      "--once"
    ];
    if (String(channelType).toLowerCase() === "cli") runArgs.push("--ingest-only");
    const code = await runNodeScript(path.join(installRoot, "command", "channel_run.mjs"), runArgs, { cwd: rootDir });
    const payload = {
      ok: code === 0,
      route: "channel poll",
      rootDir,
      agentName,
      channelType,
      code
    };
    if (json) {
      jsonOut(payload);
    } else {
      textOut(`channel poll ${code === 0 ? "passed" : "failed"} (code=${code})`);
    }
    if (code !== 0) process.exit(code);
  }

  async function channelLogCommand(args) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
    const channelType = parseArgValue(args, "--channel") ?? "matrix";
    const tailCount = normalizeTailCount(parseArgValue(args, "--tail"), 80);
    const log = await readChannelLog({ worldRoot, agentName, channelType, tailCount, readText });
    const payload = {
      ok: true,
      route: "channel log",
      worldRoot,
      agentName,
      channelType,
      tailCount,
      log
    };
    if (json) {
      jsonOut(payload);
      return;
    }
    if (!log.found) {
      textOut("channel log not found");
      return;
    }
    textOut(`channel log ${log.filePath}`);
    textOut(`- total lines ${log.totalLines}`);
    textOut(`- showing ${log.lines.length}`);
    for (const line of log.lines) textOut(line);
  }

  async function channelBootstrapCommand(args) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
    const channelType = (parseArgValue(args, "--channel") ?? "matrix").toLowerCase();
    const executiveUsername = String(parseArgValue(args, "--executive") ?? "").trim();
    if (channelType !== "matrix") {
      throw new Error(`unsupported channel bootstrap type: ${channelType}`);
    }
    const bootstrap = await bootstrapAgentMatrixChannelConnection({
      rootDir,
      worldRoot,
      agentName,
      executiveUsernameOverride: executiveUsername
    });
    const payload = {
      ok: bootstrap?.ok === true,
      route: "channel bootstrap",
      rootDir,
      worldRoot,
      agentName,
      channelType,
      bootstrap
    };
    if (json) {
      jsonOut(payload);
    } else if (payload.ok) {
      textOut("channel bootstrap complete");
      textOut(`- agent ${agentName}`);
      if (bootstrap?.joinedRoomId) textOut(`- room joined ${bootstrap.joinedRoomId}`);
      if (bootstrap?.executiveDm?.attempted) {
        textOut(`- executive dm room ${bootstrap.executiveDm.roomId || "resolved"}`);
      }
    } else {
      textOut("channel bootstrap failed");
      textOut(`- agent ${agentName}`);
      if (bootstrap?.reason) textOut(`- reason ${bootstrap.reason}`);
      if (bootstrap?.step && bootstrap?.error) textOut(`- ${bootstrap.step}: ${bootstrap.error}`);
    }
    if (!payload.ok) process.exit(1);
  }

  async function channelCliSendCommand(args) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const agentName = normalizeChannelAgentName(parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME);
    const channelId = String(parseArgValue(args, "--room") ?? "cli").trim() || "cli";
    const sender = String(parseArgValue(args, "--sender") ?? "cli").trim() || "cli";
    const text = String(parseArgValue(args, "--text") ?? "").trim();
    if (!text) throw new Error("channel cli send requires --text");
    const enqueue = await enqueueCliInbound({
      worldRoot,
      agentName,
      channelId,
      sender,
      text
    });
    const payload = {
      ok: true,
      route: "channel cli send",
      worldRoot,
      agentName,
      channelId,
      sender,
      eventId: enqueue.eventId,
      filePath: enqueue.filePath
    };
    if (json) {
      jsonOut(payload);
      return;
    }
    textOut("channel cli send complete");
    textOut(`- agent ${agentName}`);
    textOut(`- room ${channelId}`);
    textOut(`- sender ${sender}`);
    textOut(`- event ${enqueue.eventId}`);
  }

  async function channelCliReadCommand(args) {
    const rootDir = await resolveRootDirFromArgs(args);
    const worldRoot = path.join(rootDir, "world");
    const json = hasFlag(args, "--json");
    const agentName = normalizeChannelAgentName(parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME);
    const maxItems = normalizeTailCount(parseArgValue(args, "--tail"), 20);
    const rows = [];

    function parseChannelIdFromEndpoint(endpoint) {
      const text = String(endpoint ?? "").trim();
      const match = text.match(/^channel\s+\S+\s+room\s+(.+)$/i);
      if (!match) return "cli";
      return String(match[1] ?? "").trim() || "cli";
    }

    for (let i = 0; i < maxItems; i += 1) {
      const claim = await claimOldestProduceEnvelope(worldRoot, {
        workerTag: `${agentName}-cli-read`,
        channelType: "cli",
        agentName
      });
      if (!claim) break;
      try {
        const payloadSentence = claim?.envelope?.payloadSentence ?? {};
        const text = String(payloadSentence?.ob?.text ?? "").trim();
        const channelId = parseChannelIdFromEndpoint(payloadSentence?.to?.name);
        rows.push({
          channelId,
          eventId: String(claim?.envelope?.eventId ?? "").trim(),
          payloadId: String(claim?.envelope?.payloadId ?? "").trim(),
          queuedAt: String(claim?.envelope?.queuedAt ?? "").trim(),
          text
        });
        await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claim.path });
      } catch {
        await ackRuntimeEnvelopeFail(worldRoot, {
          runtimePath: claim.path,
          retryCount: 1,
          maxRetries: 1,
          requeuePhase: "produce"
        });
      }
    }

    const payload = {
      ok: true,
      route: "channel cli read",
      worldRoot,
      agentName,
      consumed: rows.length,
      rows
    };
    if (json) {
      jsonOut(payload);
      return;
    }
    if (!rows.length) {
      textOut("channel cli read no pending messages");
      return;
    }
    textOut(`channel cli read consumed ${rows.length}`);
    for (const row of rows) {
      const prefix = row.queuedAt ? `[${row.queuedAt}]` : "[message]";
      textOut(`${prefix} room=${row.channelId} ${row.text}`);
    }
  }

  async function channelCliCommand(args) {
    const sub = (args[0] ?? "read").toLowerCase();
    if (sub === "send") {
      await channelCliSendCommand(args.slice(1));
      return;
    }
    if (sub === "read") {
      await channelCliReadCommand(args.slice(1));
      return;
    }
    throw new Error(`unknown channel cli command: ${sub}`);
  }

  return async function channelCommand(args) {
    const sub = (args[0] ?? "poll").toLowerCase();
    if (sub === "poll") {
      await channelPollCommand(args.slice(1));
      return;
    }
    if (sub === "bootstrap") {
      await channelBootstrapCommand(args.slice(1));
      return;
    }
    if (sub === "log") {
      await channelLogCommand(args.slice(1));
      return;
    }
    if (sub === "cli") {
      await channelCliCommand(args.slice(1));
      return;
    }
    throw new Error(`unknown channel command: ${sub}`);
  };
}
