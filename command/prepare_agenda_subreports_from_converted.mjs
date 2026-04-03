#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickRichestAgendaMarkdownPathFromConvertedDir } from "../program/library/agenda_preview_shared.mjs";

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const PYASH_ROOT = path.resolve(COMMAND_DIR, "..");
const RUN_BIN = path.join(PYASH_ROOT, "run");

function usage() {
  return [
    "Usage: node command/prepare_agenda_subreports_from_converted.mjs <converted_dir> <subreport_dir> <subreport_index_json> <prune_script> [agenda_html_path] [meeting_url]",
    "Selects the richest converted agenda markdown (largest agenda-*.md), prunes it, then extracts subreports.",
  ].join("\n");
}

function runWithStreaming({ cmd, args, cwd = PYASH_ROOT, timeoutMs = 10 * 60 * 1000, label = "stage" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      process.stderr.write(text);
    });

    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(10_000, Number(timeoutMs) || 10_000));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? "null"} signal=${signal ?? ""})\n${stderr || stdout}`.trim()));
    });
  });
}

async function main() {
  const convertedDir = path.resolve(process.cwd(), process.argv[2] || "");
  const subreportDir = path.resolve(process.cwd(), process.argv[3] || "");
  const subreportIndexPath = path.resolve(process.cwd(), process.argv[4] || "");
  const pruneScript = path.resolve(process.cwd(), process.argv[5] || "");
  const agendaHtmlPath = String(process.argv[6] || "");
  const meetingUrl = String(process.argv[7] || "");

  if (!convertedDir || !subreportDir || !subreportIndexPath || !pruneScript) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const agendaMdPath = pickRichestAgendaMarkdownPathFromConvertedDir(convertedDir);
  if (!agendaMdPath || !fs.existsSync(agendaMdPath)) {
    process.stdout.write("[agenda-subreports] no agenda markdown found; skipping subreport extraction\n");
    process.exit(0);
  }
  if (!fs.existsSync(pruneScript)) {
    throw new Error(`prune script not found: ${pruneScript}`);
  }

  fs.mkdirSync(subreportDir, { recursive: true });
  const agendaMdStat = fs.statSync(agendaMdPath);
  process.stdout.write(`[agenda-subreports] selected agenda markdown: ${agendaMdPath}\n`);
  process.stdout.write(`[agenda-subreports] selected size bytes: ${Number(agendaMdStat.size || 0)}\n`);

  const prunedPath = agendaMdPath.replace(/\.md$/iu, ".pruned.md");
  await runWithStreaming({
    cmd: "node",
    args: [pruneScript, agendaMdPath, prunedPath],
    cwd: PYASH_ROOT,
    timeoutMs: 2 * 60 * 1000,
    label: "prune-agenda",
  });

  const extractSubreportsPya = path.join(PYASH_ROOT, "program/extract-subreports-fromstate-wo-escribe-full.pya");
  await runWithStreaming({
    cmd: RUN_BIN,
    args: [extractSubreportsPya, agendaMdPath, subreportDir, subreportIndexPath, agendaHtmlPath, meetingUrl],
    cwd: PYASH_ROOT,
    timeoutMs: 10 * 60 * 1000,
    label: "extract-subreports",
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});

