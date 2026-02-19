import path from "node:path";
import { spawn } from "node:child_process";
import { resolveRootDirFromArgs } from "./fs_paths.mjs";

function tomlString(value = "") {
  return JSON.stringify(String(value ?? ""));
}

function tomlArray(values = []) {
  const out = Array.isArray(values) ? values : [];
  return `[${out.map((value) => tomlString(value)).join(", ")}]`;
}

export function parseCodexWrapperArgs(args = []) {
  const out = {
    root: "",
    toolsMap: "agent tools",
    noMcp: false,
    passthrough: []
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] ?? "");
    if (arg === "--") {
      out.passthrough.push(...args.slice(i + 1));
      break;
    }
    if (arg === "--no-mcp") {
      out.noMcp = true;
      continue;
    }
    if (arg === "--root") {
      out.root = String(args[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      out.root = String(arg.slice("--root=".length)).trim();
      continue;
    }
    if (arg === "--tools-map") {
      out.toolsMap = String(args[i + 1] ?? "").trim() || out.toolsMap;
      i += 1;
      continue;
    }
    if (arg.startsWith("--tools-map=")) {
      out.toolsMap = String(arg.slice("--tools-map=".length)).trim() || out.toolsMap;
      continue;
    }
    out.passthrough.push(arg);
  }
  return out;
}

export async function codexCommand(args, { installRoot, cwd = "", envOverrides = null } = {}) {
  const parsed = parseCodexWrapperArgs(args);
  const rootDir = parsed.root
    ? path.resolve(parsed.root)
    : await resolveRootDirFromArgs([]);
  const finalArgs = [];
  if (!parsed.noMcp) {
    const serverPath = path.join(installRoot, "command", "pyash_mcp_server.mjs");
    const serverArgs = [serverPath, "--root", rootDir, "--tools-map", parsed.toolsMap || "agent tools"];
    finalArgs.push("-c", `mcp_servers.pyash.command=${tomlString("node")}`);
    finalArgs.push("-c", `mcp_servers.pyash.args=${tomlArray(serverArgs)}`);
  }
  finalArgs.push(...parsed.passthrough);

  const code = await new Promise((resolve, reject) => {
    const child = spawn("codex", finalArgs, {
      cwd: cwd ? path.resolve(cwd) : rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(envOverrides && typeof envOverrides === "object" ? envOverrides : {})
      }
    });
    child.on("error", reject);
    child.on("close", (status) => resolve(Number(status ?? 0)));
  });
  return code;
}
