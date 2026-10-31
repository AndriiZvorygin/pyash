import fsSync from "node:fs";
import path from "node:path";
import { renderSayValue } from "../say.mjs";

export function resolveCommandText(ob = {}, { rememberFn } = {}) {
  if (typeof ob.wo === "string") return ob.wo;
  return renderSayValue(ob, { rememberFn });
}

export function canRunDirect(cmd) {
  if (typeof cmd !== "string") return false;
  if (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) return false;
  return !/[|&;<>()$`\\]/.test(cmd) && !/["']/.test(cmd);
}

export function splitCommand(cmd) {
  return String(cmd).trim().split(/\s+/).filter(Boolean);
}

export function resolveDirectProgram(programName) {
  const name = String(programName ?? "").trim();
  if (!name) return name;
  if (name === "node") {
    const fromPath = resolveExecutableFromPath("node");
    if (fromPath) return fromPath;
    if (process.execPath && isExecutablePath(process.execPath)) return process.execPath;
    return "node";
  }
  return name;
}

function isExecutablePath(filename) {
  try {
    return fsSync.existsSync(filename) && fsSync.statSync(filename).isFile();
  } catch {
    return false;
  }
}

function resolveExecutableFromPath(name) {
  const envPath = String(process.env.PATH ?? "");
  const dirs = envPath.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (isExecutablePath(candidate)) return candidate;
  }
  return null;
}

export function resolveShellCommand() {
  const configured = String(process.env.SHELL ?? "").trim();
  const candidates = [];
  if (configured) candidates.push(configured);
  if (configured && configured.includes(path.sep)) {
    const base = path.basename(configured);
    if (base) candidates.push(base);
  }
  candidates.push("sh", "bash", "/bin/sh", "/bin/bash", "/usr/bin/sh", "/usr/bin/bash");

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep)) {
      if (isExecutablePath(candidate)) return candidate;
      continue;
    }
    const resolved = resolveExecutableFromPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

