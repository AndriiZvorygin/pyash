import fs from "node:fs/promises";
import path from "node:path";

function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

export function normalizeIntervalMinutes(raw, fallback = 24) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function buildAgentRuntimeBlock({ backend, model, toolsMap }) {
  return [
    "su name agent runtime be map def",
    `  su name backend ob text ${quoteText(backend)} ya`,
    `  su name model ob text ${quoteText(model)} ya`,
    `  su name tools map ob text ${quoteText(toolsMap)} ya`,
    "prah"
  ].join("\n");
}

function buildAgentChannelScheduleBlock({ agentName, intervalSeconds = 10, buildChannelPollCalendarBlock, matrixCatererName }) {
  const everySecond = Math.max(1, Math.floor(Number(intervalSeconds) || 10));
  return buildChannelPollCalendarBlock({
    agentName,
    channels: [matrixCatererName],
    intervalSeconds: everySecond
  });
}

export async function upsertAgentRuntime({
  worldRoot,
  agentName,
  backend,
  model,
  toolsMap,
  dryRun = false,
  resolveConfiguredAgentHouse,
  readText,
  planManagedUpsert,
  ensureDirForFile
}) {
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const runtimePath = path.join(agentHouse, "conduct", "runtime.pya");
  const existing = await readText(runtimePath);
  const plan = planManagedUpsert({
    existing,
    blockName: "agent runtime",
    content: buildAgentRuntimeBlock({ backend, model, toolsMap })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(runtimePath);
    await fs.writeFile(runtimePath, plan.nextText, "utf8");
  }
  return {
    path: runtimePath,
    changed: plan.changed,
    action: plan.action
  };
}

export async function bindAgentToDefaultChannel({
  rootDir,
  worldRoot,
  agentName,
  dryRun = false,
  loadMatrixConfigureDefaults,
  resolveConfiguredAgentHouse,
  resolveAgentMatrixUserId,
  normalizeMatrixMode,
  defaultMatrixChannelMode,
  matrixPolicyBlockName,
  buildAgentChannelConductBlock,
  readText,
  planManagedUpsert,
  ensureDirForFile
}) {
  const matrix = await loadMatrixConfigureDefaults({ rootDir, agentName });
  if (!matrix?.homeserver || !matrix?.room) {
    return {
      ok: false,
      reason: "missing channel configure",
      path: null,
      changed: false,
      action: "none"
    };
  }
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const channelPath = path.join(agentHouse, "conduct", "channels.pya");
  const canProvisionPerAgent = Boolean(
    String(matrix.registrationSharedSecret || "").trim()
    || String(matrix.adminToken || "").trim()
  );
  const userId = canProvisionPerAgent
    ? resolveAgentMatrixUserId({
      agentName,
      homeserver: matrix.homeserver,
      defaultUserId: matrix.userId
    })
    : String(matrix.userId || "").trim();
  const existing = await readText(channelPath);
  const plan = planManagedUpsert({
    existing,
    blockName: matrixPolicyBlockName,
    content: buildAgentChannelConductBlock({ userId })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(channelPath);
    await fs.writeFile(channelPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: channelPath,
    changed: plan.changed,
    action: plan.action,
    homeserver: matrix.homeserver,
    room: matrix.room,
    mode: normalizeMatrixMode(matrix.mode || "", defaultMatrixChannelMode)
  };
}

function orderedExecutiveUsernames({ override = "", channelConfig = {} } = {}) {
  const ordered = [];
  const seen = new Set();
  const pushValue = (value) => {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    ordered.push(text);
  };
  pushValue(override);
  for (const value of Array.isArray(channelConfig?.executiveUsernames) ? channelConfig.executiveUsernames : []) {
    pushValue(value);
  }
  if (channelConfig?.executiveUsername) pushValue(channelConfig.executiveUsername);
  return ordered;
}

export async function bootstrapAgentMatrixChannelConnection({
  rootDir,
  worldRoot,
  agentName,
  executiveUsernameOverride = "",
  loadMatrixConfigureDefaults,
  normalizeMatrixMode,
  defaultMatrixChannelMode,
  resolveConfiguredAgentHouse,
  resolveAgentMatrixUserId,
  matrixUsersMatch,
  ensureMatrixCredentials,
  matrixJoinRoom,
  matrixInviteRoomMember,
  loadChannelPolicyWithGlobal,
  ensureMatrixExecutiveDmRoom
}) {
  const matrix = await loadMatrixConfigureDefaults({ rootDir, agentName });
  if (!matrix?.homeserver || !matrix?.room) {
    return {
      ok: false,
      skipped: true,
      reason: "missing channel configure"
    };
  }

  const mode = normalizeMatrixMode(matrix.mode || "", defaultMatrixChannelMode);
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const canProvisionPerAgent = Boolean(
    String(matrix.registrationSharedSecret || "").trim()
    || String(matrix.adminToken || "").trim()
  );
  const userId = canProvisionPerAgent
    ? resolveAgentMatrixUserId({
      agentName,
      homeserver: matrix.homeserver,
      defaultUserId: matrix.userId
    })
    : String(matrix.userId || "").trim();
  const reuseGlobalToken = Boolean(String(matrix.token || "").trim()) && (
    !canProvisionPerAgent
    || !String(matrix.userId || "").trim()
    || matrixUsersMatch(userId, matrix.userId, matrix.homeserver)
  );
  let credentials;
  try {
    credentials = await ensureMatrixCredentials({
      agentName,
      agentHouse,
      config: {
        homeserver: matrix.homeserver,
        user: userId || null,
        token: reuseGlobalToken ? (matrix.token || null) : null,
        mode,
        registrationSharedSecret: matrix.registrationSharedSecret || null,
        adminToken: matrix.adminToken || null
      }
    });
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      step: "credentials",
      error: String(err?.message || err)
    };
  }

  const token = String(credentials?.token || (reuseGlobalToken ? matrix.token : "") || "").trim();
  const resolvedUserId = String(credentials?.user || userId || matrix.userId || "").trim();
  if (!token) {
    return {
      ok: false,
      skipped: true,
      reason: "missing token"
    };
  }

  let joinedRoomId = "";
  try {
    joinedRoomId = await matrixJoinRoom({
      homeserver: matrix.homeserver,
      token,
      room: matrix.room,
      mode,
      userId: resolvedUserId
    });
  } catch (err) {
    const joinMessage = String(err?.message || err);
    const inviterToken = String(matrix.token || "").trim();
    const inviterUserId = String(matrix.userId || "").trim();
    const canInviteFallback = /M_FORBIDDEN/i.test(joinMessage)
      && Boolean(inviterToken && inviterUserId)
      && !matrixUsersMatch(inviterUserId, resolvedUserId, matrix.homeserver);
    if (canInviteFallback) {
      try {
        const inviterRoomId = await matrixJoinRoom({
          homeserver: matrix.homeserver,
          token: inviterToken,
          room: matrix.room,
          mode,
          userId: inviterUserId
        });
        await matrixInviteRoomMember({
          homeserver: matrix.homeserver,
          token: inviterToken,
          roomId: inviterRoomId,
          inviteUserId: resolvedUserId,
          mode,
          userId: inviterUserId
        });
        joinedRoomId = await matrixJoinRoom({
          homeserver: matrix.homeserver,
          token,
          room: inviterRoomId,
          mode,
          userId: resolvedUserId
        });
      } catch (inviteErr) {
        return {
          ok: false,
          skipped: false,
          step: "join room",
          userId: resolvedUserId,
          error: `${joinMessage}; invite fallback failed: ${String(inviteErr?.message || inviteErr)}`
        };
      }
    } else {
      return {
        ok: false,
        skipped: false,
        step: "join room",
        userId: resolvedUserId,
        error: joinMessage
      };
    }
  }

  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const executiveUsernames = orderedExecutiveUsernames({
    override: executiveUsernameOverride,
    channelConfig: allChannels?.matrix ?? {}
  });
  if (!executiveUsernames.length) {
    return {
      ok: true,
      mode,
      homeserver: matrix.homeserver,
      room: matrix.room,
      joinedRoomId,
      userId: resolvedUserId,
      executiveDm: {
        attempted: false
      }
    };
  }

  const dmRooms = [];
  let lastError = null;
  for (const executiveUsername of executiveUsernames) {
    try {
      const dmRoomId = await ensureMatrixExecutiveDmRoom({
        agentHouse,
        homeserver: matrix.homeserver,
        token,
        user: resolvedUserId,
        mode,
        executiveUser: executiveUsername
      });
      if (dmRoomId) dmRooms.push(dmRoomId);
    } catch (err) {
      lastError = {
        executiveUsername,
        error: String(err?.message || err)
      };
    }
  }
  if (!dmRooms.length && lastError) {
    return {
      ok: false,
      skipped: false,
      step: "executive dm",
      userId: resolvedUserId,
      joinedRoomId,
      error: `${lastError.executiveUsername}: ${lastError.error}`
    };
  }
  return {
    ok: true,
    mode,
    homeserver: matrix.homeserver,
    room: matrix.room,
    joinedRoomId,
    userId: resolvedUserId,
    executiveDm: {
      attempted: true,
      executiveUsernames,
      roomIds: dmRooms,
      roomId: dmRooms[0] || ""
    }
  };
}

function buildAgentDirectoryLicenseBlock({ rootDir, agentName }) {
  const declaredHouse = path.join("world", "house", agentName);
  const lines = [
    `su name ${agentName} house directory ob filename ${quoteText(declaredHouse)} ya`,
    `su name ${agentName} directory license be map def`,
    `  su name ${quoteText(declaredHouse)} ob ve text "read" "write" "command" ya`
  ];
  if (String(agentName).trim() === "parity coder") {
    lines.push(`  su name ${quoteText(path.resolve(rootDir))} ob ve text "read" "write" "command" ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

export async function upsertAgentDirectoryLicense({
  rootDir,
  worldRoot,
  agentName,
  dryRun = false,
  readText,
  planManagedUpsert,
  ensureDirForFile
}) {
  const policyPath = path.join(worldRoot, "conduct", "agent.pya");
  const existing = await readText(policyPath);
  const plan = planManagedUpsert({
    existing,
    blockName: `agent directory license ${agentName}`,
    content: buildAgentDirectoryLicenseBlock({ rootDir, agentName })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(policyPath);
    await fs.writeFile(policyPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: policyPath,
    changed: plan.changed,
    action: plan.action
  };
}

export async function upsertAgentChannelSchedule({
  worldRoot,
  agentName,
  channelType = "matrix",
  intervalMinutes = 1,
  intervalSeconds = 10,
  dryRun = false,
  resolveConfiguredAgentHouse,
  readText,
  stripAgentChannelScheduleText,
  planManagedUpsert,
  ensureDirForFile,
  buildChannelPollCalendarBlock,
  matrixCatererName
}) {
  if (String(channelType || "").trim().toLowerCase() !== "matrix") {
    return {
      ok: false,
      reason: "unsupported channel type",
      path: null,
      changed: false,
      action: "none"
    };
  }
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const calendarPath = path.join(agentHouse, "conduct", "calendar.pya");
  const existing = await readText(calendarPath);
  const calendarWithoutLegacyPoll = stripAgentChannelScheduleText({
    existing,
    agentName,
    scheduleName: "poll",
    includeManagedBlockLines: false
  });
  const plan = planManagedUpsert({
    existing: calendarWithoutLegacyPoll,
    blockName: "agent channel schedule",
    content: buildAgentChannelScheduleBlock({
      agentName,
      intervalSeconds: Number.isFinite(Number(intervalSeconds)) && Number(intervalSeconds) > 0
        ? Number(intervalSeconds)
        : Math.max(1, normalizeIntervalMinutes(intervalMinutes, 1) * 60),
      buildChannelPollCalendarBlock,
      matrixCatererName
    })
  });
  const changed = plan.changed || (calendarWithoutLegacyPoll !== existing);
  if (!dryRun && changed) {
    await ensureDirForFile(calendarPath);
    await fs.writeFile(calendarPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: calendarPath,
    changed,
    action: plan.action
  };
}
