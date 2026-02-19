import fs from "node:fs/promises";
import path from "node:path";

export function usage({ DEFAULT_MATRIX_APPSERVICE_REGISTRATION }) {
  return [
    "Usage:",
    "  pyash run <file.pya> [run flags...]",
    "  pyash <file.pya> [run flags...]",
    "  pyash repl",
    "  pyash configure",
    "  pyash configure intro [--root <path>] [--json]",
    "  pyash configure orchestrator [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--mode <container|local>] [--host <hostname>] [--port <n>] [--autostart <truth|lie>] [--health-rhythm-minute <n>]",
    "  pyash configure channel",
    "  pyash configure channel list [--json]",
    "  pyash configure channel matrix [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--quickstart|--advanced] [--test-now <truth|lie>] [--start-now <truth|lie>] [--homeserver <url>] [--room <id-or-alias>] [--mode <poll|sync|appservice-push>] [--appservice-registration <path>] [--executive <@user:server>]... [--agent-user-id <@user:server>] [--auth-mode <password|token|shared-secret>] [--password <password>] [--token <token>] [--registration-shared-secret <secret>] [--admin-token <token>] [--agent <name>] [--write-agent-policy <truth|lie>] [--public-tag-answer <truth|lie>]",
    "  pyash configure channel matrix test [--root <path>] [--json]",
    "  pyash configure channel matrix doctor [--root <path>] [--json]",
    "  pyash configure mind [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--relay <name>] [--set-default <truth|lie>] [--backend <name>] [--host <url>] [--model <name>] [--reasoning-effort <name>] [--test-now <truth|lie>] [--codex-login <truth|lie>] [--codex-bin <path>]",
    "  pyash configure agent",
    "  pyash configure agent list [--root <path>] [--json]",
    "  pyash configure agent establish [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--agent <name>] [--purpose <text>] [--interval-minutes <n>] [--relay <name|number>] [--backend <name>] [--model <name>] [--tools-map <name>] [--bind-channel <truth|lie>] [--smoke-test <truth|lie>] [--start-now <truth|lie>]",
    "  pyash configure agent improve [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--agent <name>] [--purpose <text>] [--interval-minutes <n>] [--relay <name|number>] [--backend <name>] [--model <name>] [--tools-map <name>] [--bind-channel <truth|lie>] [--smoke-test <truth|lie>] [--start-now <truth|lie>]",
    "  pyash configure agent delete [--root <path>] [--non-interactive] [--json] [--agent <name>] [--yes <truth|lie>]",
    "  pyash calendar <health|begin|stop|restart|list> [--root <path>] [--agent <name>] [--json]",
    "  pyash channel poll [--root <path>] [--agent <name>] [--channel <matrix|cli>] [--json]",
    "  pyash channel bootstrap [--root <path>] [--agent <name>] [--channel <matrix>] [--executive <@user:server>] [--json]",
    "  pyash channel log [--root <path>] [--agent <name>] [--channel <matrix|cli>] [--tail <n>] [--json]",
    "  pyash channel cli send [--root <path>] [--agent <name>] [--room <name>] [--sender <name>] --text <text> [--json]",
    "  pyash channel cli read [--root <path>] [--agent <name>] [--tail <n>] [--json]",
    "  pyash codex [--root <path>] [--tools-map <name>] [--no-mcp] [-- <codex args...>]",
    "  pyash agent <name> --codex [--status] [--root <path>] [--tools-map <name>] [--codex-home <auto|global|agent|path>] [--no-mcp] [-- <codex args...>]",
    "  pyash verify <file.pya> [--root <path>] [--json]",
    "  pyash verify --text \"<pyash sentences>\" [--json]",
    "",
    "Notes:",
    "  - Recommended onboarding route is: pyash configure intro",
    "  - Canonical configure route is: pyash configure channel <caterer>",
    "  - Channel config writes managed blocks to configure/secret.pya",
    `  - Matrix appservice default registration path is ${DEFAULT_MATRIX_APPSERVICE_REGISTRATION}`,
    "  - Optional channel conduct writes to declared agent house conduct/channels.pya"
  ].join("\n");
}

export function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function textOut(value = "") {
  process.stdout.write(`${value}\n`);
}

export function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

export function buildOrchestratorConfigureBlock(cfg, quote) {
  return [
    "su name orchestrator configure be map def",
    `  su name mode ob text ${quote(cfg.mode)} ya`,
    `  su name host ob text ${quote(cfg.host)} ya`,
    `  su name port ob text ${quote(String(cfg.port))} ya`,
    `  su name autostart ob text ${quote(cfg.autostart ? "truth" : "lie")} ya`,
    `  su name health rhythm minute ob text ${quote(String(cfg.healthMinute))} ya`,
    "prah"
  ].join("\n");
}

export function buildAgentChannelConductBlock({ userId = "", authMode = "", token = "", password = "" }, quote) {
  const lines = [];
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedAuthMode = String(authMode ?? "").trim().toLowerCase();
  const normalizedToken = String(token ?? "").trim();
  const normalizedPassword = String(password ?? "").trim();
  if (normalizedAuthMode) lines.push(`su name matrix auth mode ob text ${quote(normalizedAuthMode)} ya`);
  if (normalizedUserId) lines.push(`su name matrix user ob text ${quote(normalizedUserId)} ya`);
  if (normalizedToken) lines.push(`su name matrix token ob text ${quote(normalizedToken)} ya`);
  if (normalizedPassword) lines.push(`su name matrix password ob text ${quote(normalizedPassword)} ya`);
  if (!lines.length) return "# no per-agent matrix overrides";
  return lines.join("\n");
}

export function unquotePyashText(value) {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const inner = text.slice(1, -1);
  return inner
    .replace(/\\\\/g, "\\")
    .replace(/\\\"/g, "\"");
}

export function parseMapBlock(blockText, unquote = unquotePyashText) {
  const out = {};
  const linePattern = /su name (.+?)\s+ob text\s+("[^"\\]*(?:\\.[^"\\]*)*")\s+ya/g;
  for (const match of blockText.matchAll(linePattern)) {
    out[match[1]] = unquote(match[2]);
  }
  return out;
}

export function createLoadOrchestratorConfigFromSecret({ readText, extractManagedBlock, ORCHESTRATOR_CONFIG_BLOCK_NAME }) {
  return async function loadOrchestratorConfigFromSecret(rootDir) {
    const secretPath = path.join(rootDir, "configure", "secret.pya");
    const text = await readText(secretPath);
    if (!text) return {};
    const orchestratorBlock = extractManagedBlock(text, ORCHESTRATOR_CONFIG_BLOCK_NAME);
    const values = parseMapBlock(orchestratorBlock);
    return {
      mode: values.mode || "",
      host: values.host || "",
      port: values.port || "",
      autostart: values.autostart || "",
      healthMinute: values["health rhythm minute"] || ""
    };
  };
}

export async function applyWritePlan(plan, ensureDirForFile) {
  for (const write of plan.writes) {
    if (!write.changed) continue;
    await ensureDirForFile(write.path);
    await fs.writeFile(write.path, write.nextText, "utf8");
  }
}

export function writePlanSummary(plan) {
  return plan.writes.map((write) => ({
    path: write.path,
    changed: write.changed,
    action: write.action,
    blocks: write.preview
  }));
}

export function createConfigureChannelList({ MATRIX_CATERER_NAME, jsonOut, textOut }) {
  return async function configureChannelList({ json }) {
    const payload = {
      ok: true,
      caterers: [{
        name: MATRIX_CATERER_NAME,
        supports: ["configure", "test", "doctor"]
      }]
    };
    if (json) jsonOut(payload);
    else {
      textOut("Available caterers:");
      textOut("- matrix (configure, test, doctor)");
    }
  };
}

export function renderShortPreview(text) {
  const trimmed = String(text || "").trimEnd();
  const lines = trimmed.split("\n");
  if (lines.length <= 30) return trimmed;
  return `${lines.slice(0, 30).join("\n")}\n... (${lines.length - 30} more lines)`;
}
