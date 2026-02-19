import { spawn } from "node:child_process";

export async function runNodeScript(scriptPath, args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
      cwd,
      env: process.env
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      resolve(code ?? 0);
    });
  });
}

export async function runCodexAccountCommand({
  action,
  codexBin = "",
  cwd = process.cwd(),
  json = false,
  codexAccountPath
}) {
  const args = [action];
  if (json) args.push("--json");
  if (codexBin) args.push("--codex-bin", codexBin);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [codexAccountPath, ...args], {
      stdio: json ? ["ignore", "pipe", "pipe"] : "inherit",
      cwd,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    if (json) {
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    }
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
