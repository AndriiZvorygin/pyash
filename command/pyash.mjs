#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const runner = path.join(rootDir, "command", "run_pya_program.mjs");

const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
