import path from "node:path";

export function createMatrixState(deps) {
  const {
    readText,
    extractManagedBlock,
    parseMapBlock,
    normalizeMatrixMode,
    DEFAULT_MATRIX_CHANNEL_MODE,
    DEFAULT_CHANNEL_AGENT_NAME,
    MATRIX_BLOCK_NAME,
    CHANNEL_CONFIG_BLOCK_NAME,
    loadChannelPolicyWithGlobal,
    resolveConfiguredAgentHouse,
    normalizeHomeserver,
    MATRIX_CHANNEL_MODES,
    isAppserviceMode,
    matrixSupportsSharedSecret,
    homeserverHost,
    matrixServerFromId,
    loginMatrixWithPassword,
    matrixWhoAmI,
    matrixVersions,
    ensureMatrixCredentials,
    resolveConfiguredAgentHouseFromRoot,
    ensureMatrixExecutiveDmRoom,
    matrixJoinRoom,
    matrixSendRoomMessage,
    matrixCreateDirectRoom,
    readMatrixAppserviceRegistration,
    redactMatrixConfig,
    matrixUserIdFromLocalpart,
    matrixUsersMatch,
    resolveAgentMatrixUserId,
    matrixInviteRoomMember,
    backendChoiceKey,
    MIND_CONFIG_BLOCK_NAME,
    MIND_RELAYS_BLOCK_NAME,
    DEFAULT_MIND_RELAY_NAME
  } = deps;

  async function loadMatrixConfigFromSecret(rootDir) {
    const text = await readText(path.join(rootDir, "configure", "secret.pya"));
    if (!text) return {};
    const matrixValues = parseMapBlock(extractManagedBlock(text, MATRIX_BLOCK_NAME));
    const channelValues = parseMapBlock(extractManagedBlock(text, CHANNEL_CONFIG_BLOCK_NAME));
    return {
      defaultCaterer: channelValues["default caterer"] || "",
      homeserver: matrixValues.homeserver || "",
      appserviceRegistration: matrixValues["bridge service file"] || matrixValues["appservice registration"] || "",
      userId: "",
      authMode: "",
      token: "",
      password: "",
      registrationSharedSecret: matrixValues["registration shared secret"] || "",
      adminToken: "",
      legacyRoom: matrixValues.room || "",
      legacyMode: matrixValues.mode || ""
    };
  }

  async function loadMatrixPolicyConfig({ rootDir, agentName = DEFAULT_CHANNEL_AGENT_NAME } = {}) {
    const worldRoot = path.join(rootDir, "world");
    const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
    const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
    const matrix = allChannels?.matrix ?? {};
    const roomEntries = Array.isArray(matrix.rooms) ? matrix.rooms : [];
    const dmRooms = new Set(Array.isArray(matrix.dmRooms) ? matrix.dmRooms.map((r) => String(r ?? "").trim()) : []);
    const primaryRoom = roomEntries.find((entry) => {
      const id = String(entry?.id ?? "").trim();
      return id && !dmRooms.has(id);
    })?.id ?? roomEntries[0]?.id ?? "";
    const executives = Array.isArray(matrix.executiveUsernames)
      ? matrix.executiveUsernames.map((v) => String(v ?? "").trim()).filter(Boolean)
      : [];
    return {
      room: String(primaryRoom ?? "").trim(),
      mode: normalizeMatrixMode(matrix.mode || "", DEFAULT_MATRIX_CHANNEL_MODE),
      authMode: String(matrix.authMode || "").trim().toLowerCase(),
      publicTagAnswer: matrix.publicTagAnswer === true,
      executiveUsername: executives[0] || "",
      executiveUsernames: executives,
      userId: String(matrix.user || "").trim(),
      token: String(matrix.token || "").trim(),
      password: String(matrix.password || "").trim(),
      hasPolicy: Boolean(allChannels?.matrix)
    };
  }

  async function loadMatrixConfigureDefaults({ rootDir, agentName = DEFAULT_CHANNEL_AGENT_NAME } = {}) {
    const [secret, policy] = await Promise.all([
      loadMatrixConfigFromSecret(rootDir),
      loadMatrixPolicyConfig({ rootDir, agentName })
    ]);
    const legacyMode = normalizeMatrixMode(secret.legacyMode || "", DEFAULT_MATRIX_CHANNEL_MODE);
    return {
      ...secret,
      room: policy.room || secret.legacyRoom || "",
      mode: policy.hasPolicy ? policy.mode : legacyMode,
      authMode: policy.authMode || secret.authMode || "password",
      publicTagAnswer: policy.publicTagAnswer === true,
      executiveUsername: policy.executiveUsername || "",
      executiveUsernames: policy.executiveUsernames || [],
      userId: policy.userId || secret.userId || "",
      token: policy.token || secret.token || "",
      password: policy.password || secret.password || ""
    };
  }

  async function loadMindConfigFromSecret(rootDir) {
    const text = await readText(path.join(rootDir, "configure", "secret.pya"));
    if (!text) return {};
    const values = parseMapBlock(extractManagedBlock(text, MIND_CONFIG_BLOCK_NAME));
    const relayValues = parseMapBlock(extractManagedBlock(text, MIND_RELAYS_BLOCK_NAME));
    const relays = {};
    for (const [key, value] of Object.entries(relayValues)) {
      const match = key.match(/^relay (.+) (backend|host|model|source|reasoning effort)$/);
      if (!match) continue;
      const relayName = String(match[1] ?? "").trim();
      const field = match[2] === "reasoning effort" ? "reasoningEffort" : match[2];
      if (!relayName) continue;
      if (!relays[relayName]) relays[relayName] = { source: "", backend: "", host: "", model: "", reasoningEffort: "" };
      relays[relayName][field] = String(value ?? "").trim();
    }
    if (!Object.keys(relays).length && values.backend && values.host && values.model) {
      relays[DEFAULT_MIND_RELAY_NAME] = {
        source: backendChoiceKey(values.backend),
        backend: String(values.backend).trim(),
        host: String(values.host).trim(),
        model: String(values.model).trim(),
        reasoningEffort: String(values["reasoning effort"] || "").trim()
      };
    }
    for (const relayName of Object.keys(relays)) {
      const relay = relays[relayName];
      if (!relay.source) relay.source = backendChoiceKey(relay.backend || "");
    }
    let defaultRelay = String(relayValues["default relay"] || "").trim();
    if (!defaultRelay) defaultRelay = Object.keys(relays)[0] || DEFAULT_MIND_RELAY_NAME;
    if (!relays[defaultRelay] && Object.keys(relays).length > 0) defaultRelay = Object.keys(relays)[0];
    const selected = relays[defaultRelay] ?? {};
    const source = String(selected.source || values.source || "").trim();
    const backend = String(selected.backend || values.backend || "").trim();
    const host = String(selected.host || values.host || "").trim();
    const model = String(selected.model || values.model || "").trim();
    const reasoningEffort = String(selected.reasoningEffort || values["reasoning effort"] || "").trim();
    return { source: source || backendChoiceKey(backend), backend, host, model, reasoningEffort, defaultRelay, relays };
  }

  function matrixVerification(cfg) {
    const errors = [];
    const warnings = [];
    const homeserver = normalizeHomeserver(cfg.homeserver);
    const room = String(cfg.room || "").trim();
    const authMode = String(cfg.authMode || "").trim();
    const channelMode = normalizeMatrixMode(cfg.mode || "", "");
    const appserviceRegistration = String(cfg.appserviceRegistration || "").trim();
    if (!homeserver) errors.push({ code: "missing_homeserver", message: "homeserver is required" });
    if (!/^https?:\/\//i.test(homeserver)) errors.push({ code: "invalid_homeserver_url", message: "homeserver must start with http:// or https://" });
    if (!room) errors.push({ code: "missing_room", message: "room is required" });
    if (room && !room.startsWith("#") && !room.startsWith("!")) errors.push({ code: "invalid_room", message: "room must start with # or !" });
    if (!["password", "token", "shared-secret"].includes(authMode)) errors.push({ code: "invalid_auth_mode", message: "auth mode must be password, token, or shared-secret" });
    if (!MATRIX_CHANNEL_MODES.includes(channelMode)) errors.push({ code: "invalid_channel_mode", message: `mode must be ${MATRIX_CHANNEL_MODES.join(", ")}` });
    if (isAppserviceMode(channelMode) && !appserviceRegistration) errors.push({ code: "missing_appservice_registration", message: "appservice registration path is required for appservice-push mode" });
    if (authMode === "shared-secret" && !matrixSupportsSharedSecret(homeserver)) errors.push({ code: "invalid_auth_mode_for_homeserver", message: "shared-secret mode is not supported for matrix.org; use password or token" });
    if (authMode === "password") {
      if (!cfg.userId) errors.push({ code: "missing_user", message: "agent user id is required for password mode" });
      if (!cfg.password && !cfg.token) errors.push({ code: "missing_password", message: "password (or existing token) is required for password mode" });
    }
    if (authMode === "token" && !cfg.token) errors.push({ code: "missing_token", message: "token is required for token mode" });
    if (authMode === "shared-secret") {
      if (!cfg.registrationSharedSecret) errors.push({ code: "missing_registration_shared_secret", message: "registration shared secret is required" });
      if (!cfg.userId) warnings.push({ code: "missing_user_shared_secret", message: "agent user id is recommended for shared-secret mode" });
    }
    const host = homeserverHost(homeserver);
    const roomServer = matrixServerFromId(room);
    if (host && roomServer && host !== roomServer) warnings.push({ code: "room_server_mismatch", message: `room server (${roomServer}) differs from homeserver (${host})` });
    return { ok: errors.length === 0, errors, warnings };
  }

  async function matrixLiveTest(cfg) {
    const checks = [];
    try {
      await matrixVersions({ homeserver: cfg.homeserver });
      checks.push({ name: "homeserver reachable", ok: true });
    } catch (err) {
      checks.push({ name: "homeserver reachable", ok: false, error: String(err?.message || err) });
      return { ok: false, checks };
    }

    let token = cfg.token;
    if (!token && cfg.authMode === "password" && cfg.userId && cfg.password) {
      try {
        const login = await loginMatrixWithPassword({ homeserver: cfg.homeserver, userId: cfg.userId, password: cfg.password });
        token = login.token;
        checks.push({ name: "password login", ok: true, userId: login.userId || cfg.userId });
      } catch (err) {
        checks.push({ name: "password login", ok: false, error: String(err?.message || err) });
        return { ok: false, checks };
      }
    }
    if (!token) return { ok: false, checks: [...checks, { name: "auth verification", ok: false, error: "missing token for whoami" }] };
    try {
      const who = await matrixWhoAmI({ homeserver: cfg.homeserver, token, userId: cfg.userId || "", mode: cfg.mode || "" });
      checks.push({ name: "whoami", ok: true, userId: who.userId || null });
    } catch (err) {
      checks.push({ name: "whoami", ok: false, error: String(err?.message || err) });
      return { ok: false, checks };
    }
    return { ok: true, checks };
  }

  async function ensureSharedSecretToken({ cfg, rootDir }) {
    if (cfg.authMode !== "shared-secret" || cfg.token) return cfg;
    const agentName = String(cfg.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim() || DEFAULT_CHANNEL_AGENT_NAME;
    const agentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, agentName);
    const credentials = await ensureMatrixCredentials({
      agentName,
      agentHouse,
      config: {
        homeserver: cfg.homeserver,
        user: cfg.userId || null,
        token: cfg.token || null,
        registrationSharedSecret: cfg.registrationSharedSecret || null,
        adminToken: cfg.adminToken || null
      }
    });
    return { ...cfg, token: credentials.token || cfg.token, userId: cfg.userId || credentials.user || "" };
  }

  async function ensureExecutiveDmRoom({ cfg, rootDir }) {
    const agentName = String(cfg.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim() || DEFAULT_CHANNEL_AGENT_NAME;
    return await ensureMatrixExecutiveDmRoom({
      agentHouse: resolveConfiguredAgentHouseFromRoot(rootDir, agentName),
      homeserver: cfg.homeserver,
      token: cfg.token,
      user: cfg.userId,
      mode: cfg.mode || "",
      executiveUser: cfg.executiveUsername
    });
  }

  async function matrixPostSetupTest(cfg, { rootDir } = {}) {
    const checks = [];
    const executiveUsernames = Array.from(new Set([...(Array.isArray(cfg.executiveUsernames) ? cfg.executiveUsernames : []), cfg.executiveUsername].map((v) => String(v ?? "").trim()).filter(Boolean)));
    const live = await matrixLiveTest(cfg);
    checks.push(...(live.checks || []));
    if (!live.ok) return { ok: false, checks };
    if (!cfg.token) {
      checks.push({ name: "room join + greeting", ok: true, note: "skipped: no token available" });
      if (executiveUsernames.length > 0) checks.push({ name: "executive dm greeting", ok: true, note: "skipped: no token available" });
      return { ok: true, checks };
    }
    try {
      const joinedRoomId = await matrixJoinRoom({ homeserver: cfg.homeserver, token: cfg.token, room: cfg.room, mode: cfg.mode || "", userId: cfg.userId || "" });
      checks.push({ name: "join room", ok: true, roomId: joinedRoomId });
      const roomEventId = await matrixSendRoomMessage({ homeserver: cfg.homeserver, token: cfg.token, roomId: joinedRoomId, content: "Pyash configure test greeting. If you can read this, channel setup works.", mode: cfg.mode || "", userId: cfg.userId || "" });
      checks.push({ name: "send room greeting", ok: true, eventId: roomEventId });
    } catch (err) {
      checks.push({ name: "room join + greeting", ok: false, error: String(err?.message || err) });
      return { ok: false, checks };
    }
    for (const executiveUsername of executiveUsernames) {
      try {
        const dmRoomId = rootDir
          ? await ensureExecutiveDmRoom({ cfg: { ...cfg, executiveUsername }, rootDir })
          : await matrixCreateDirectRoom({ homeserver: cfg.homeserver, token: cfg.token, executiveUsername, mode: cfg.mode || "", userId: cfg.userId || "" });
        checks.push({ name: "resolve executive dm room", ok: true, executiveUsername, roomId: dmRoomId });
        const dmEventId = await matrixSendRoomMessage({ homeserver: cfg.homeserver, token: cfg.token, roomId: dmRoomId, content: "Pyash configure DM test greeting. Executive messaging is working.", mode: cfg.mode || "", userId: cfg.userId || "" });
        checks.push({ name: "send executive dm greeting", ok: true, executiveUsername, eventId: dmEventId });
      } catch (err) {
        checks.push({ name: "executive dm greeting", ok: false, executiveUsername, error: String(err?.message || err) });
        return { ok: false, checks };
      }
    }
    return { ok: true, checks };
  }

  function applyAppserviceAuthDefaults(cfg, appserviceLoaded) {
    if (!cfg || !isAppserviceMode(cfg.mode) || !appserviceLoaded) return cfg;
    const next = { ...cfg };
    const currentAuthMode = String(next.authMode || "").trim().toLowerCase();
    if (!currentAuthMode || currentAuthMode === "password" || currentAuthMode === "shared-secret") next.authMode = "token";
    if (!next.token) next.token = String(appserviceLoaded.asToken || "").trim();
    const expectedUserId = matrixUserIdFromLocalpart(appserviceLoaded.senderLocalpart, next.homeserver);
    const currentLocalpart = String(next.userId || "").replace(/^@/, "").split(":")[0];
    const expectedLocalpart = String(appserviceLoaded.senderLocalpart || "").trim();
    if (!next.userId || (expectedLocalpart && currentLocalpart !== expectedLocalpart)) next.userId = expectedUserId;
    return next;
  }

  return {
    loadMatrixConfigFromSecret,
    loadMatrixPolicyConfig,
    loadMatrixConfigureDefaults,
    loadMindConfigFromSecret,
    matrixVerification,
    matrixLiveTest,
    ensureSharedSecretToken,
    ensureExecutiveDmRoom,
    matrixPostSetupTest,
    applyAppserviceAuthDefaults
  };
}
