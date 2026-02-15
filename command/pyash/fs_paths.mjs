import fs from "node:fs/promises";
import path from "node:path";
import { parseArgValue } from "./cli_args.mjs";

export async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export async function detectProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const hasCommand = await pathExists(path.join(current, "command", "pyash.mjs"));
    const hasConfigureSecret = await pathExists(path.join(current, "configure", "secret.pya"));
    if (hasCommand || hasConfigureSecret) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function resolveRootDirFromArgs(args = []) {
  const explicitRoot = parseArgValue(args, "--root");
  if (explicitRoot) return path.resolve(explicitRoot);
  return await detectProjectRoot(process.cwd()) || process.cwd();
}

export async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
