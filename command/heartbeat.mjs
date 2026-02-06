import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { resolveAgentHouse } from "../program/agent/session.mjs";

const DEFAULT_INTERVAL_S = 24 * 60;
const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";
const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your agent house.
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: ${HEARTBEAT_OK_TOKEN}`;

function readFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const inline = args.find(arg => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  return null;
}

function isHeartbeatEmpty(content) {
  if (!content) return true;
  const skipPatterns = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<!--")) continue;
    if (skipPatterns.has(line)) continue;
    return false;
  }
  return true;
}

function normalizeOk(text) {
  return String(text ?? "").toUpperCase().replace(/[_\s]+/g, "");
}

async function runHeartbeatOnce({ agentName, heartbeatPath }) {
  let content = "";
  try {
    content = await fs.readFile(heartbeatPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { skipped: true, reason: "missing" };
    throw err;
  }
  if (isHeartbeatEmpty(content)) return { skipped: true, reason: "empty" };

  const sentence = parse(
    `ob text ${JSON.stringify(HEARTBEAT_PROMPT)} ` +
    `for name ${agentName} ` +
    `to name text heartbeat-out ` +
    `with wo tools ` +
    `fromtext name "session name heartbeat" ` +
    `be write do`
  );
  const result = await interpret(sentence);
  const responseText = result?.ob?.text ?? "";
  const ok = normalizeOk(responseText).includes(normalizeOk(HEARTBEAT_OK_TOKEN));
  return { skipped: false, ok, responseText };
}

async function main() {
  const args = process.argv.slice(2);
  const agentName = readFlagValue(args, "--agent") ?? readFlagValue(args, "-a");
  if (!agentName) {
    console.error("Usage: node command/heartbeat.mjs --agent <name> [--once] [--interval <seconds>]");
    process.exit(1);
  }
  const once = args.includes("--once");
  const intervalRaw = readFlagValue(args, "--interval");
  const intervalS = intervalRaw ? Number(intervalRaw) : DEFAULT_INTERVAL_S;
  if (!Number.isFinite(intervalS) || intervalS <= 0) {
    console.error("Invalid --interval value");
    process.exit(1);
  }

  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) {
    registerSignatureHandler(sig);
  }
  await loadDefaultConfig({ cwd: process.cwd(), interpretFn: interpret, entryPath: process.cwd() });
  if (!remember(agentName)) {
    await interpret(parse(`exists su name ${agentName} be mind ya`));
  }

  const agentHouse = resolveAgentHouse({ mindName: agentName, rememberFn: null });
  const heartbeatPath = path.join(agentHouse, "HEARTBEAT.md");

  const runOnce = async () => {
    const result = await runHeartbeatOnce({ agentName, heartbeatPath });
    if (result.skipped) {
      console.log(`heartbeat skipped (${result.reason})`);
      return;
    }
    if (result.ok) {
      console.log("heartbeat ok");
    } else {
      console.log("heartbeat completed");
    }
  };

  if (once) {
    await runOnce();
    return;
  }

  console.log(`heartbeat running every ${intervalS}s for ${agentName}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise(resolve => setTimeout(resolve, intervalS * 1000));
    await runOnce();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
