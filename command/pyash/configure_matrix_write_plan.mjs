import path from "node:path";

function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

function buildMatrixMapBlock(cfg) {
  const lines = [
    "su name matrix channel be map def",
    `  su name homeserver ob text ${quoteText(cfg.homeserver)} ya`
  ];
  if (cfg.appserviceRegistration) lines.push(`  su name bridge service file ob text ${quoteText(String(cfg.appserviceRegistration))} ya`);
  if (cfg.registrationSharedSecret) lines.push(`  su name registration shared secret ob text ${quoteText(cfg.registrationSharedSecret)} ya`);
  lines.push("prah");
  return lines.join("\n");
}

function buildChannelConfigureBlock(matrixCatererName) {
  return [
    "su name channel configure be map def",
    `  su name default caterer ob text ${quoteText(matrixCatererName)} ya`,
    "  su name matrix ob name matrix channel ya",
    "prah"
  ].join("\n");
}

function buildChannelConductBlock({
  room,
  executiveUsernames = [],
  publicTagAnswer = true,
  toolSummary = false,
  dmToolSummary = true,
  mode,
  userId = "",
  normalizeMatrixMode,
  defaultMatrixChannelMode
}) {
  const normalizedMode = normalizeMatrixMode(mode, defaultMatrixChannelMode);
  return [
    "su name matrix channel ob bool truth ya",
    `su name matrix public tag answer ob bool ${publicTagAnswer ? "truth" : "lie"} ya`,
    `su name matrix tool summary ob bool ${toolSummary ? "truth" : "lie"} ya`,
    `su name matrix dm tool summary ob bool ${dmToolSummary ? "truth" : "lie"} ya`,
    `su name matrix mode ob text ${quoteText(normalizedMode)} ya`,
    `su name matrix room ob text ${quoteText(room)} ya`,
    ...Array.from(new Set((Array.isArray(executiveUsernames) ? executiveUsernames : []).map((v) => String(v ?? "").trim()).filter(Boolean))).map((executive) => `su name matrix executive username ob text ${quoteText(executive)} ya`),
    ...(userId ? [`su name matrix user ob text ${quoteText(userId)} ya`] : [])
  ].join("\n");
}

function buildAgentChannelConductBlock({ userId = "", authMode = "", token = "", password = "" }) {
  const lines = [];
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedAuthMode = String(authMode ?? "").trim().toLowerCase();
  const normalizedToken = String(token ?? "").trim();
  const normalizedPassword = String(password ?? "").trim();
  if (normalizedAuthMode) lines.push(`su name matrix auth mode ob text ${quoteText(normalizedAuthMode)} ya`);
  if (normalizedUserId) lines.push(`su name matrix user ob text ${quoteText(normalizedUserId)} ya`);
  if (normalizedToken) lines.push(`su name matrix token ob text ${quoteText(normalizedToken)} ya`);
  if (normalizedPassword) lines.push(`su name matrix password ob text ${quoteText(normalizedPassword)} ya`);
  if (!lines.length) return "# no per-agent matrix overrides";
  return lines.join("\n");
}

export async function createMatrixWritePlan({
  rootDir,
  cfg,
  readText,
  planManagedUpsert,
  resolveConfiguredAgentHouseFromRoot,
  scrubLegacyMatrixChannelSeed,
  stripLegacySingleChannelScheduleText,
  stripAgentChannelScheduleText,
  buildChannelPollCalendarBlock,
  buildChannelInputCalendarBlock,
  buildChannelProduceCalendarBlock,
  normalizeMatrixMode,
  defaultMatrixChannelMode,
  matrixCatererName,
  matrixBlockName,
  channelConfigBlockName,
  matrixWorldPolicyBlockName,
  matrixPolicyBlockName,
  defaultChannelPollIntervalSeconds
}) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);
  const matrixBlockPlan = planManagedUpsert({ existing: secretExisting, blockName: matrixBlockName, content: buildMatrixMapBlock(cfg) });
  const channelBlockPlan = planManagedUpsert({ existing: matrixBlockPlan.nextText, blockName: channelConfigBlockName, content: buildChannelConfigureBlock(matrixCatererName) });
  const writes = [{ path: secretPath, changed: channelBlockPlan.changed || matrixBlockPlan.changed, action: channelBlockPlan.action, preview: [matrixBlockName, channelConfigBlockName], nextText: channelBlockPlan.nextText }];

  const worldChannelPath = path.join(rootDir, "world", "conduct", "channels.pya");
  const worldChannelExisting = await readText(worldChannelPath);
  const worldChannelScrubbed = scrubLegacyMatrixChannelSeed(worldChannelExisting);
  const worldChannelSeedChanged = worldChannelScrubbed !== worldChannelExisting;
  const worldPolicyPlan = planManagedUpsert({
    existing: worldChannelScrubbed,
    blockName: matrixWorldPolicyBlockName,
    content: buildChannelConductBlock({
      room: cfg.room,
      executiveUsernames: Array.isArray(cfg.executiveUsernames) ? cfg.executiveUsernames : [],
      publicTagAnswer: cfg.publicTagAnswer,
      toolSummary: false,
      dmToolSummary: true,
      mode: cfg.mode,
      normalizeMatrixMode,
      defaultMatrixChannelMode
    })
  });
  writes.push({ path: worldChannelPath, changed: worldPolicyPlan.changed || worldChannelSeedChanged, action: worldPolicyPlan.action, preview: [matrixWorldPolicyBlockName], nextText: worldPolicyPlan.nextText });

  if (cfg.writeAgentPolicy && cfg.agentName && cfg.agentName.trim()) {
    const configuredAgentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, cfg.agentName);
    const channelPath = path.join(configuredAgentHouse, "conduct", "channels.pya");
    const channelExisting = await readText(channelPath);
    const channelSeedScrubbed = scrubLegacyMatrixChannelSeed(channelExisting);
    const channelSeedChanged = channelSeedScrubbed !== channelExisting;
    const policyPlan = planManagedUpsert({
      existing: channelSeedScrubbed,
      blockName: matrixPolicyBlockName,
      content: buildAgentChannelConductBlock({ userId: cfg.userId, authMode: cfg.authMode, token: cfg.token, password: cfg.password })
    });
    writes.push({ path: channelPath, changed: policyPlan.changed || channelSeedChanged, action: policyPlan.action, preview: [matrixPolicyBlockName], nextText: policyPlan.nextText });
  }

  if (cfg.agentName && cfg.agentName.trim()) {
    const configuredAgentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, cfg.agentName);
    const worldCalendarPath = path.join(rootDir, "world", "conduct", "calendar.pya");
    const worldCalendarExisting = await readText(worldCalendarPath);
    const worldLegacyCleaned = stripLegacySingleChannelScheduleText({ existing: worldCalendarExisting, channelType: matrixCatererName, scheduleNames: ["probe", "input", "produce"] });
    const worldWithoutPoll = stripAgentChannelScheduleText({ existing: worldLegacyCleaned, agentName: cfg.agentName, scheduleName: "poll" });
    const worldWithoutInput = stripAgentChannelScheduleText({ existing: worldWithoutPoll, agentName: cfg.agentName, scheduleName: "input" });
    const worldWithoutProduce = stripAgentChannelScheduleText({ existing: worldWithoutInput, agentName: cfg.agentName, scheduleName: "produce" });
    const worldPollPlan = planManagedUpsert({ existing: worldWithoutProduce, blockName: "channel poll schedule", content: buildChannelPollCalendarBlock({ channelType: matrixCatererName, intervalSeconds: defaultChannelPollIntervalSeconds }) });
    const worldInputPlan = planManagedUpsert({ existing: worldPollPlan.nextText, blockName: "channel input schedule", content: buildChannelInputCalendarBlock({ channels: [matrixCatererName], intervalSeconds: 1 }) });
    const worldProducePlan = planManagedUpsert({ existing: worldInputPlan.nextText, blockName: "channel produce schedule", content: buildChannelProduceCalendarBlock({ channels: [matrixCatererName], intervalSeconds: 1 }) });
    writes.push({ path: worldCalendarPath, changed: worldPollPlan.changed || worldInputPlan.changed || worldProducePlan.changed || (worldLegacyCleaned !== worldCalendarExisting), action: worldProducePlan.action, preview: ["channel poll schedule", "channel input schedule", "channel produce schedule"], nextText: worldProducePlan.nextText });

    const calendarPath = path.join(configuredAgentHouse, "conduct", "calendar.pya");
    const calendarExisting = await readText(calendarPath);
    const calendarWithoutPoll = stripAgentChannelScheduleText({ existing: calendarExisting, agentName: cfg.agentName, scheduleName: "poll" });
    const calendarWithoutInput = stripAgentChannelScheduleText({ existing: calendarWithoutPoll, agentName: cfg.agentName, scheduleName: "input" });
    const calendarWithoutProduce = stripAgentChannelScheduleText({ existing: calendarWithoutInput, agentName: cfg.agentName, scheduleName: "produce" });
    writes.push({ path: calendarPath, changed: calendarWithoutProduce !== calendarExisting, action: "replace", preview: ["channel poll calendar cleanup", "channel input calendar cleanup", "channel produce calendar cleanup"], nextText: calendarWithoutProduce });
  }

  return { writes, changed: writes.some((item) => item.changed) };
}
