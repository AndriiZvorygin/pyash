export async function matrixDoctor({
  rootDir,
  DEFAULT_CHANNEL_AGENT_NAME,
  loadMatrixConfigureDefaults,
  ensureSharedSecretToken,
  matrixVerification,
  isAppserviceMode,
  readMatrixAppserviceRegistration,
  matrixLiveTest,
  redactMatrixConfig
}) {
  const loaded = await loadMatrixConfigureDefaults({ rootDir, agentName: DEFAULT_CHANNEL_AGENT_NAME });
  const configExists = Boolean(loaded.homeserver || loaded.room || loaded.token || loaded.userId || loaded.registrationSharedSecret || loaded.adminToken);
  if (!configExists) {
    return {
      ok: false,
      issues: [{ code: "missing_config", kind: "missing", message: "matrix channel config is missing from configure/secret.pya + world/conduct/channels.pya" }],
      remedies: ["run: pyash configure channel matrix"]
    };
  }

  const resolved = await ensureSharedSecretToken({ cfg: { ...loaded, agentName: DEFAULT_CHANNEL_AGENT_NAME }, rootDir });
  const verification = matrixVerification(resolved);
  const issues = [];
  for (const err of verification.errors) issues.push({ code: err.code, kind: "invalid", message: err.message });
  for (const warn of verification.warnings) issues.push({ code: warn.code, kind: "warning", message: warn.message });
  if (loaded.legacyRoom) issues.push({ code: "legacy_secret_room", kind: "warning", message: "legacy room declaration found in configure/secret.pya; room now belongs in world/conduct/channels.pya" });
  if (loaded.legacyMode) issues.push({ code: "legacy_secret_mode", kind: "warning", message: "legacy mode declaration found in configure/secret.pya; mode now belongs in world/conduct/channels.pya" });

  let appservice = null;
  if (isAppserviceMode(resolved.mode) && resolved.appserviceRegistration) {
    try {
      const reg = await readMatrixAppserviceRegistration({ rootDir, registrationPath: resolved.appserviceRegistration });
      appservice = { path: reg.path, id: reg.id || "", senderLocalpart: reg.senderLocalpart, url: reg.url, hasAsToken: Boolean(reg.asToken), hasHsToken: Boolean(reg.hsToken) };
    } catch (err) {
      issues.push({ code: "invalid_appservice_registration", kind: "invalid", message: String(err?.message || err) });
    }
  }

  let live = null;
  if (verification.ok) {
    live = await matrixLiveTest(resolved);
    if (!live.ok) issues.push({ code: "live_check_failed", kind: "unreachable", message: "live check failed; inspect checks for details" });
  }

  const remedies = [];
  if (!verification.ok) remedies.push("rerun configure: pyash configure channel matrix");
  if (issues.some((i) => i.code === "room_server_mismatch")) remedies.push("set room server suffix to match homeserver host");
  if (issues.some((i) => i.code === "live_check_failed")) remedies.push("verify homeserver reachability and credentials, then rerun: pyash configure channel matrix test");

  return {
    ok: verification.ok && (!live || live.ok) && !issues.some((i) => i.kind === "invalid"),
    config: redactMatrixConfig(resolved),
    issues,
    live,
    appservice,
    remedies
  };
}
