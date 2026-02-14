import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function usage() {
  return [
    "Usage: node command/agent_creation_smoke.mjs [options]",
    "",
    "Options:",
    "  --root <path>                 Root directory (default: cwd)",
    "  --agent <name>                Agent to create/recreate (default: agent-creation-smoke)",
    "  --executive <@user:server>    Executive/smoke user (default: @mricge-smoke:matrix.liberit.ca)",
    "  --wipe <truth|lie>            Wipe agent house first (default: truth)",
    "  --restart-calendar <truth|lie> Restore scheduler state (default: truth)",
    "  --restore-room <truth|lie>    Restore original channel room (default: truth)",
    "  --json                        Output JSON",
    "  --help                        Show help"
  ].join("\n");
}

function parseTruthy(raw, fallback = false) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["truth", "true", "yes", "y", "1", "on"].includes(value)) return true;
  if (["lie", "false", "no", "n", "0", "off"].includes(value)) return false;
  return fallback;
}

function runNode({ rootDir, args }) {
  const run = spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: "utf8"
  });
  let payload = null;
  const stdout = String(run.stdout ?? "").trim();
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }
  return {
    status: run.status,
    stdout: String(run.stdout ?? ""),
    stderr: String(run.stderr ?? ""),
    payload
  };
}

function requireOk(run, label) {
  if (run.status !== 0) {
    throw new Error(`${label} failed (status=${run.status}): ${run.stderr || run.stdout}`);
  }
  return run.payload ?? {};
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, "--help")) {
    console.log(usage());
    return;
  }

  const rootDir = path.resolve(readFlagValue(args, "--root") ?? process.cwd());
  const agentName = String(readFlagValue(args, "--agent") ?? "agent-creation-smoke").trim();
  const executive = String(readFlagValue(args, "--executive") ?? "@mricge-smoke:matrix.liberit.ca").trim();
  const wipe = parseTruthy(readFlagValue(args, "--wipe"), true);
  const restartCalendar = parseTruthy(readFlagValue(args, "--restart-calendar"), true);
  const restoreRoom = parseTruthy(readFlagValue(args, "--restore-room"), true);
  const json = hasFlag(args, "--json");

  if (!agentName) throw new Error("--agent is required");
  if (!executive) throw new Error("--executive is required");

  const summary = {
    ok: false,
    rootDir,
    agentName,
    executive,
    matrixSmoke: {},
    checks: {}
  };

  const matrixSmokeRun = runNode({
    rootDir,
    args: [
      "command/matrix_configure_smoke.mjs",
      "--agent", agentName,
      "--executive", executive,
      "--wipe", wipe ? "truth" : "lie",
      "--restart-calendar", restartCalendar ? "truth" : "lie",
      "--restore-room", restoreRoom ? "truth" : "lie",
      "--json"
    ]
  });
  const matrixSmoke = requireOk(matrixSmokeRun, "matrix configure smoke");
  summary.matrixSmoke = matrixSmoke;

  const housePath = path.join(rootDir, "world", "house", agentName);
  const expectedFiles = [
    path.join(housePath, "conduct", "managed.pya"),
    path.join(housePath, "conduct", "runtime.pya"),
    path.join(housePath, "conduct", "channels.pya"),
    path.join(housePath, "conduct", "calendar.pya"),
    path.join(housePath, "conduct", "matrix-auth.pya"),
    path.join(housePath, "identity", "IDENTITY.md"),
    path.join(housePath, "identity", "SOUL.md"),
    path.join(housePath, "identity", "TOOLS.md"),
    path.join(housePath, "identity", "USER.md")
  ];

  const existence = {};
  for (const filePath of expectedFiles) {
    existence[filePath] = await pathExists(filePath);
  }
  const allFilesPresent = Object.values(existence).every(Boolean);

  const runtimePath = path.join(housePath, "conduct", "runtime.pya");
  const runtimeText = await fs.readFile(runtimePath, "utf8").catch(() => "");
  const runtimeHasBackend = /su name backend ob text /i.test(runtimeText);
  const runtimeHasModel = /su name model ob text /i.test(runtimeText);

  const policyPath = path.join(rootDir, "world", "conduct", "agent.pya");
  const policyText = await fs.readFile(policyPath, "utf8").catch(() => "");
  const hasDirectoryLicense = new RegExp(`su name\\s+${agentName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s+directory license\\s+be map def`, "i").test(policyText);

  const agentList = requireOk(
    runNode({
      rootDir,
      args: ["command/pyash.mjs", "configure", "agent", "list", "--root", rootDir, "--json"]
    }),
    "configure agent list"
  );
  const listed = Array.isArray(agentList?.agents) && agentList.agents.some((item) => String(item?.agentName ?? "") === agentName);

  summary.checks = {
    matrixSmokeOk: Boolean(matrixSmoke?.ok),
    expectedFilesPresent: allFilesPresent,
    runtimeHasBackend,
    runtimeHasModel,
    hasDirectoryLicense,
    listedByConfigureAgentList: listed,
    fileExistence: existence
  };

  summary.ok = Boolean(
    summary.checks.matrixSmokeOk
    && summary.checks.expectedFilesPresent
    && summary.checks.runtimeHasBackend
    && summary.checks.runtimeHasModel
    && summary.checks.hasDirectoryLicense
    && summary.checks.listedByConfigureAgentList
  );

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`agent creation smoke ${summary.ok ? "passed" : "failed"}`);
    console.log(`- agent ${agentName}`);
    console.log(`- matrix smoke ${summary.checks.matrixSmokeOk}`);
    console.log(`- files present ${summary.checks.expectedFilesPresent}`);
    console.log(`- runtime backend/model ${runtimeHasBackend}/${runtimeHasModel}`);
    console.log(`- directory license ${hasDirectoryLicense}`);
    console.log(`- listed by configure agent list ${listed}`);
  }

  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
