import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseItineraryPya, encodeSecondsForFilename } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/itinerary_to_draw_images.mjs <input-itinerary.pya> <output-dir> [--limit <n>] [--prefix <text>] [--prompter <text>] [--host <url>] [--workflow-name <name>] [--dry-run]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error(usage());
  const out = {
    input: args[0],
    outputDir: args[1],
    limit: Number.POSITIVE_INFINITY,
    prefix: "teaching",
    prompter: "",
    host: "",
    workflowName: "",
    dryRun: false
  };
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--limit") out.limit = Number(args[++i] ?? Number.POSITIVE_INFINITY);
    else if (arg === "--prefix") out.prefix = String(args[++i] ?? out.prefix);
    else if (arg === "--prompter") out.prompter = String(args[++i] ?? "");
    else if (arg === "--host") out.host = String(args[++i] ?? "");
    else if (arg === "--workflow-name") out.workflowName = String(args[++i] ?? "");
    else if (arg === "--dry-run") out.dryRun = true;
    else throw new Error(usage());
  }
  if ((Number.isFinite(out.limit) && out.limit <= 0) || Number.isNaN(out.limit)) {
    throw new Error("limit must be > 0");
  }
  return out;
}

function promptFromCut(cut, prompter = "") {
  const lead = String(prompter ?? "").trim();
  const core = String(cut?.obText ?? "").trim();
  if (lead && core) return `${lead}\n\n${core}`;
  if (lead) return lead;
  return core;
}

function outputPathForCut(outputDir, prefix, cut) {
  const idx = String(cut.index).padStart(3, "0");
  const start = encodeSecondsForFilename(cut.since);
  const end = encodeSecondsForFilename(cut.until);
  return path.join(outputDir, `${prefix}-cut-${idx}-${start}-${end}.png`);
}

async function runDraw({ prompt, output, host, workflowName }) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const runner = path.join(here, "draw_comfyui_runner.mjs");
  const args = [runner, "--prompt", prompt, "--output", output];
  if (host) args.push("--host", host);
  if (workflowName) args.push("--workflow-name", workflowName);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
      else reject(new Error(stderr.trim() || `draw failed with status ${code}`));
    });
  });
}

export { promptFromCut, outputPathForCut, runDraw, parseArgs };

export async function main() {
  const opts = parseArgs(process.argv);
  const text = await fs.readFile(opts.input, "utf8");
  const itinerary = parseItineraryPya(text);
  const cuts = itinerary.cuts.slice(0, Math.floor(opts.limit));
  await fs.mkdir(opts.outputDir, { recursive: true });
  for (const cut of cuts) {
    const output = outputPathForCut(opts.outputDir, opts.prefix, cut);
    const prompt = promptFromCut(cut, opts.prompter);
    if (!opts.dryRun) {
      await runDraw({ prompt, output, host: opts.host, workflowName: opts.workflowName });
    }
    process.stdout.write(`${cut.index}\t${output}\n`);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
