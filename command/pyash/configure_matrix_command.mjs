import path from "node:path";
import { collectMatrixInteractive } from "./configure_matrix_interactive.mjs";

export function createConfigureMatrixCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    parseArgValues,
    parseTruthy,
    normalizeHomeserver,
    homeserverHost,
    ensureMatrixIdServer,
    rewriteMatrixIdServer,
    ensureMatrixUserServer,
    normalizeMatrixMode,
    isAppserviceMode,
    sanitizeMatrixLocalpart,
    matrixLocalpartFromUserId,
    normalizeChannelAgentName,
    loadMatrixConfigureDefaults,
    matrixVerification,
    readMatrixAppserviceRegistration,
    applyAppserviceAuthDefaults,
    redactMatrixConfig,
    loginMatrixWithPassword,
    ensureSharedSecretToken,
    matrixPostSetupTest,
    createMatrixWritePlan,
    establishAgent,
    schedulerRestart,
    applyWritePlan,
    writePlanSummary,
    readMatrixAuthCache,
    writeMatrixAuthCache,
    resolveConfiguredAgentHouseFromRoot,
    matrixDoctor,
    matrixLiveTest,
    matrixVersions,
    matrixSupportsSharedSecret,
    matrixUserIdFromLocalpart,
    DEFAULT_MATRIX_APPSERVICE_REGISTRATION,
    DEFAULT_MATRIX_CHANNEL_MODE,
    DEFAULT_CHANNEL_AGENT_NAME,
    MATRIX_CHANNEL_MODES,
    sectionPrinter,
    pathExists,
    ensureMatrixExecutiveDmRoom,
    matrixSendRoomMessage,
    isEphemeralRootDir,
    renderShortPreview,
    jsonOut,
    textOut
  } = deps;

  function collectMatrixFromFlags({ args, prior }) {
    const homeserver = normalizeHomeserver(parseArgValue(args, "--homeserver") ?? prior.homeserver ?? "");
    const host = homeserverHost(homeserver);
    const providedRoom = parseArgValue(args, "--room");
    const room = providedRoom ? ensureMatrixIdServer(providedRoom, host) : rewriteMatrixIdServer(prior.room ?? "", host);
    const providedExecutives = parseArgValues(args, "--executive");
    const priorExecutives = Array.isArray(prior.executiveUsernames) && prior.executiveUsernames.length ? prior.executiveUsernames : [prior.executiveUsername ?? ""];
    const executiveUsernames = Array.from(new Set((providedExecutives.length ? providedExecutives : priorExecutives).map((v) => ensureMatrixUserServer(v, host)).filter(Boolean)));
    const executiveUsername = executiveUsernames[0] ?? "";
    const providedUserId = parseArgValue(args, "--agent-user-id");
    const rawUserId = String(providedUserId ?? prior.userId ?? "").trim();
    const normalizedUserIdInput = rawUserId && !rawUserId.startsWith("@") && !rawUserId.includes(":")
      ? matrixUserIdFromLocalpart(rawUserId, homeserver)
      : rawUserId;
    const userId = ensureMatrixUserServer(normalizedUserIdInput, host);
    const authMode = String(parseArgValue(args, "--auth-mode") ?? prior.authMode ?? "password").trim().toLowerCase();
    const token = parseArgValue(args, "--token") ?? prior.token ?? "";
    const password = parseArgValue(args, "--password") ?? "";
    const registrationSharedSecret = parseArgValue(args, "--registration-shared-secret") ?? prior.registrationSharedSecret ?? "";
    const adminToken = parseArgValue(args, "--admin-token") ?? prior.adminToken ?? "";
    const mode = normalizeMatrixMode(parseArgValue(args, "--mode") ?? prior.mode ?? DEFAULT_MATRIX_CHANNEL_MODE, DEFAULT_MATRIX_CHANNEL_MODE);
    const appserviceRegistration = String(parseArgValue(args, "--appservice-registration") ?? prior.appserviceRegistration ?? (isAppserviceMode(mode) ? DEFAULT_MATRIX_APPSERVICE_REGISTRATION : "")).trim();
    const explicitAgentName = parseArgValue(args, "--agent");
    const agentName = normalizeChannelAgentName(explicitAgentName ?? (providedUserId ? "" : (prior.agentName ?? "")));
    const writeAgentPolicy = parseTruthy(parseArgValue(args, "--write-agent-policy"), true);
    const publicTagAnswer = parseTruthy(parseArgValue(args, "--public-tag-answer"), prior.publicTagAnswer !== false);
    return { homeserver, room, executiveUsername, executiveUsernames, userId, authMode, token, password, registrationSharedSecret, adminToken, mode, appserviceRegistration, agentName, writeAgentPolicy, publicTagAnswer };
  }

  function normalizeMatrixCollected(cfg) {
    const homeserver = normalizeHomeserver(cfg.homeserver);
    const host = homeserverHost(homeserver);
    const room = ensureMatrixIdServer(cfg.room, host);
    const executiveUsernames = Array.from(new Set([...(Array.isArray(cfg.executiveUsernames) ? cfg.executiveUsernames : []), cfg.executiveUsername].map((v) => ensureMatrixUserServer(v, host)).filter(Boolean)));
    const mode = normalizeMatrixMode(cfg.mode || "", DEFAULT_MATRIX_CHANNEL_MODE);
    const appserviceRegistration = String(cfg.appserviceRegistration || "").trim();
    const inferredFromUserId = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(cfg.userId || ""));
    const normalizedAgentName = normalizeChannelAgentName(cfg.agentName) || inferredFromUserId || DEFAULT_CHANNEL_AGENT_NAME;
    return { ...cfg, homeserver, room, mode, appserviceRegistration, executiveUsername: executiveUsernames[0] || "", executiveUsernames, userId: ensureMatrixUserServer(cfg.userId, host), authMode: String(cfg.authMode || "password").trim().toLowerCase(), agentName: normalizedAgentName };
  }

  async function configureMatrix({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const ephemeralRoot = isEphemeralRootDir(rootDir);
    const json = hasFlag(args, "--json");
    const print = hasFlag(args, "--print");
    const dryRun = hasFlag(args, "--dry-run");
    const nonInteractive = hasFlag(args, "--non-interactive");
    const mode = hasFlag(args, "--advanced") ? "advanced" : "quickstart";
    const testNowFlag = parseArgValue(args, "--test-now");
    const startNowFlag = parseArgValue(args, "--start-now");
    const explicitAgentName = parseArgValue(args, "--agent");
    const configureAgentName = explicitAgentName ?? DEFAULT_CHANNEL_AGENT_NAME;

    const prior = await loadMatrixConfigureDefaults({ rootDir, agentName: configureAgentName });
    const collected = nonInteractive
      ? collectMatrixFromFlags({ args, prior })
      : await collectMatrixInteractive({
        prior,
        mode,
        rootDir,
        explicitAgentName,
        sectionPrinter,
        normalizeHomeserver,
        matrixVersions,
        homeserverHost,
        pathExists,
        DEFAULT_MATRIX_APPSERVICE_REGISTRATION,
        normalizeMatrixMode,
        DEFAULT_MATRIX_CHANNEL_MODE,
        MATRIX_CHANNEL_MODES,
        isAppserviceMode,
        readMatrixAppserviceRegistration,
        ensureMatrixUserServer,
        normalizeChannelAgentName,
        DEFAULT_CHANNEL_AGENT_NAME,
        matrixUserIdFromLocalpart,
        matrixSupportsSharedSecret,
        loginMatrixWithPassword,
        ensureSharedSecretToken,
        matrixLiveTest,
        rewriteMatrixIdServer,
        ensureMatrixIdServer,
        ensureMatrixExecutiveDmRoom,
        resolveConfiguredAgentHouseFromRoot,
        matrixSendRoomMessage,
        sanitizeMatrixLocalpart,
        matrixLocalpartFromUserId,
        textOut
      });

    let cfg = normalizeMatrixCollected(collected);
    if (cfg.userId || cfg.token || cfg.password || cfg.authMode) cfg = { ...cfg, writeAgentPolicy: true };

    let verification = matrixVerification(cfg);
    let appservice = null;
    if (isAppserviceMode(cfg.mode) && cfg.appserviceRegistration) {
      try {
        const appserviceLoaded = await readMatrixAppserviceRegistration({ rootDir, registrationPath: cfg.appserviceRegistration });
        cfg = applyAppserviceAuthDefaults(cfg, appserviceLoaded);
        verification = matrixVerification(cfg);
        appservice = { path: appserviceLoaded.path, id: appserviceLoaded.id || "", senderLocalpart: appserviceLoaded.senderLocalpart, url: appserviceLoaded.url, hasAsToken: Boolean(appserviceLoaded.asToken), hasHsToken: Boolean(appserviceLoaded.hsToken) };
      } catch (err) {
        verification.errors.push({ code: "invalid_appservice_registration", message: String(err?.message || err) });
        verification.ok = false;
      }
    }

    if (!verification.ok) {
      const payload = { ok: false, stage: "verification", verification, appservice, config: redactMatrixConfig(cfg) };
      if (json) jsonOut(payload);
      else {
        textOut("verification failed:");
        for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
        for (const warn of verification.warnings) textOut(`- warning ${warn.code}: ${warn.message}`);
      }
      process.exit(1);
    }

    if (cfg.authMode === "password" && !cfg.token && cfg.userId && cfg.password) {
      const login = await loginMatrixWithPassword({ homeserver: cfg.homeserver, userId: cfg.userId, password: cfg.password });
      cfg = { ...cfg, token: login.token, userId: login.userId || cfg.userId };
    }
    cfg = await ensureSharedSecretToken({ cfg, rootDir });

    if (!dryRun && cfg.writeAgentPolicy && cfg.userId && cfg.token) {
      const agentNameForAuth = String(cfg.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim() || DEFAULT_CHANNEL_AGENT_NAME;
      const agentHouseForAuth = resolveConfiguredAgentHouseFromRoot(rootDir, agentNameForAuth);
      const cachedAuth = await readMatrixAuthCache(agentHouseForAuth);
      await writeMatrixAuthCache(agentHouseForAuth, { ...(cachedAuth ?? {}), homeserver: cfg.homeserver, user: cfg.userId, accessToken: cfg.token, executiveDmRooms: cachedAuth?.executiveDmRooms ?? {} });
    }

    const runTestNow = testNowFlag == null ? !nonInteractive : parseTruthy(testNowFlag, false);
    const startSchedulerDefault = ephemeralRoot ? false : !nonInteractive;
    const startSchedulerNow = startNowFlag == null ? startSchedulerDefault : parseTruthy(startNowFlag, startSchedulerDefault);
    const live = runTestNow ? await matrixPostSetupTest(cfg, { rootDir }) : null;

    const plan = await createMatrixWritePlan({ rootDir, cfg });
    const worldRoot = path.join(rootDir, "world");
    const establish = (!dryRun && cfg.agentName && String(cfg.agentName).trim())
      ? await establishAgent({ worldRoot, agentName: cfg.agentName, writePolicy: true })
      : null;
    if (!dryRun) await applyWritePlan(plan);
    const runtime = (!dryRun && cfg.writeAgentPolicy && startSchedulerNow) ? await schedulerRestart({ worldRoot }) : null;

    const out = { ok: true, route: "configure channel matrix", rootDir, mode: nonInteractive ? "non-interactive" : cfg.mode || mode, dryRun, changed: Boolean(plan.changed || establish?.changed), writes: writePlanSummary(plan), establish, verification, live, startSchedulerNow, runtime, appservice, config: redactMatrixConfig(cfg) };
    if (json) return void jsonOut(out);

    textOut("configure channel matrix complete");
    for (const w of out.writes) textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
    if (runTestNow) {
      textOut(`post-config test ${live?.ok ? "passed" : "failed"}`);
      for (const check of live?.checks || []) textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
    if (runtime) textOut(`scheduler reload ${runtime.running ? "running" : "stopped"}`);
    if (print) {
      textOut("");
      textOut("planned blocks:");
      for (const w of plan.writes) {
        textOut(`## ${w.path}`);
        textOut(renderShortPreview(w.nextText));
      }
    }
  }

  async function configureMatrixTest({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const json = hasFlag(args, "--json");
    const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
    const loaded = await loadMatrixConfigureDefaults({ rootDir, agentName });
    const resolved = await ensureSharedSecretToken({ cfg: { ...loaded, agentName }, rootDir });
    const verification = matrixVerification(resolved);
    if (!verification.ok) {
      const payload = { ok: false, stage: "verification", verification, config: redactMatrixConfig(resolved) };
      if (json) jsonOut(payload);
      else {
        textOut("matrix test failed (verification):");
        for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
      }
      process.exit(1);
    }
    const live = await matrixPostSetupTest(resolved, { rootDir });
    const payload = { ok: live.ok, route: "configure channel matrix test", checks: live.checks, config: redactMatrixConfig(resolved) };
    if (json) jsonOut(payload);
    else {
      textOut(`matrix test ${live.ok ? "passed" : "failed"}`);
      for (const check of live.checks) textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
    if (!live.ok) process.exit(1);
  }

  async function configureMatrixDoctor({ args }) {
    const rootDir = await resolveRootDirFromArgs(args);
    const json = hasFlag(args, "--json");
    const report = await matrixDoctor({ rootDir });
    if (json) jsonOut(report);
    else {
      textOut(`matrix doctor ${report.ok ? "ok" : "needs attention"}`);
      if (report.issues?.length) {
        textOut("issues:");
        for (const issue of report.issues) textOut(`- ${issue.kind} ${issue.code}: ${issue.message}`);
      }
      if (report.remedies?.length) {
        textOut("remedies:");
        for (const remedy of report.remedies) textOut(`- ${remedy}`);
      }
    }
    if (!report.ok) process.exit(1);
  }

  return { configureMatrix, configureMatrixTest, configureMatrixDoctor };
}
