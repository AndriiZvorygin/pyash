export function resolvePublishCommand(env = process.env, order = []) {
  for (const name of order) {
    const v = String(env?.[name] || "").trim();
    if (v) return { command: v, source_env: name };
  }
  return { command: "", source_env: "" };
}

export function normalizePublishConfig({
  env = process.env,
  adapter = {},
  fallbackCommand = "",
} = {}) {
  const publish = adapter?.publish || {};
  const order = Array.isArray(publish.command_env_order) ? publish.command_env_order : [];
  const resolved = resolvePublishCommand(env, order);
  const command = resolved.command || String(fallbackCommand || "").trim();
  const community = String(env.MEETING_PUBLISH_COMMUNITY_NAME || publish.community_name || adapter?.defaults?.community_name || "").trim();
  const dryRun = /^(1|true|yes)$/iu.test(String(env.MEETING_PUBLISH_DRY_RUN || "0"));
  return {
    command,
    command_source_env: resolved.source_env,
    community_name: community,
    dry_run: dryRun,
    command_env_order: order,
  };
}

export function applyPublishEnvNormalization({ env = process.env, adapter = {}, fallbackCommand = "" } = {}) {
  const out = { ...env };
  const cfg = normalizePublishConfig({ env: out, adapter, fallbackCommand });
  if (cfg.command) out.MEETING_POST_COMMAND = cfg.command;
  if (cfg.community_name && !String(out.MEETING_PUBLISH_COMMUNITY_NAME || "").trim()) {
    out.MEETING_PUBLISH_COMMUNITY_NAME = cfg.community_name;
  }
  return { env: out, publish: cfg };
}
