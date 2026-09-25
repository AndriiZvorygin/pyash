#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TARGET_I = -14;
const DEFAULT_TRUE_PEAK = -1.5;
const DEFAULT_LRA = 11;

function usage() {
  return "Usage: node command/audio_equilibrium.mjs <input.wav> <output.wav> [--target-i -16] [--true-peak -1.5] [--lra 11]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error(usage());
  const options = {
    input: path.resolve(args[0]),
    output: path.resolve(args[1]),
    targetI: DEFAULT_TARGET_I,
    truePeak: DEFAULT_TRUE_PEAK,
    lra: DEFAULT_LRA
  };
  for (let i = 2; i < args.length; i += 1) {
    const flag = args[i];
    const value = Number(args[++i]);
    if (!Number.isFinite(value)) throw new Error(`${flag} requires a finite number`);
    if (flag === "--target-i") options.targetI = value;
    else if (flag === "--true-peak") options.truePeak = value;
    else if (flag === "--lra") options.lra = value;
    else throw new Error(usage());
  }
  if (options.input === options.output) throw new Error("input and output must be different files");
  if (options.targetI < -30 || options.targetI > -5) throw new Error("target-i must be between -30 and -5 LUFS");
  if (options.truePeak < -9 || options.truePeak > 0) throw new Error("true-peak must be between -9 and 0 dBTP");
  if (options.lra < 1 || options.lra > 20) throw new Error("lra must be between 1 and 20 LU");
  return options;
}

function runCapture(args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { stdout += String(chunk ?? ""); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
}

function parseMeasurement(stderr) {
  const start = String(stderr ?? "").lastIndexOf("{");
  const end = String(stderr ?? "").lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ffmpeg loudnorm did not report input measurements");
  let report;
  try {
    report = JSON.parse(String(stderr).slice(start, end + 1));
  } catch (err) {
    throw new Error(`could not parse ffmpeg loudnorm measurements: ${err.message}`);
  }
  const fields = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"];
  const values = {};
  for (const field of fields) {
    values[field] = Number(report[field]);
    if (!Number.isFinite(values[field])) {
      throw new Error(`ffmpeg loudnorm reported an invalid ${field}: ${JSON.stringify(report[field])}`);
    }
  }
  return values;
}

async function main() {
  const options = parseArgs(process.argv);
  await fs.access(options.input);
  await fs.mkdir(path.dirname(options.output), { recursive: true });

  const measureFilter = `loudnorm=I=${options.targetI}:TP=${options.truePeak}:LRA=${options.lra}:print_format=json`;
  const measure = await runCapture([
    "-hide_banner", "-nostats", "-i", options.input,
    "-vn", "-af", measureFilter, "-f", "null", "-"
  ]);
  if (measure.code !== 0) throw new Error(`ffmpeg loudness analysis failed: ${measure.stderr.trim().slice(-1200)}`);
  const measured = parseMeasurement(measure.stderr);

  const renderFilter = [
    `loudnorm=I=${options.targetI}`,
    `TP=${options.truePeak}`,
    `LRA=${options.lra}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    "linear=true",
    "print_format=summary"
  ].join(":");
  const render = await runCapture([
    "-y", "-hide_banner", "-nostats", "-i", options.input,
    "-vn", "-af", renderFilter,
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", options.output
  ]);
  if (render.code !== 0) throw new Error(`ffmpeg loudness render failed: ${render.stderr.trim().slice(-1200)}`);

  console.log(
    `audio equilibrium complete: input=${measured.input_i.toFixed(1)} LUFS, ` +
    `input_true_peak=${measured.input_tp.toFixed(1)} dBTP, ` +
    `target=${options.targetI} LUFS/${options.truePeak} dBTP, output=${options.output}`
  );
  const outputReport = render.stderr.match(/Output Integrated:\s*([^\n]+)/u)?.[1]?.trim();
  const peakReport = render.stderr.match(/Output True Peak:\s*([^\n]+)/u)?.[1]?.trim();
  if (outputReport || peakReport) {
    console.log(`audio equilibrium measured output: ${outputReport ?? "unknown"}, ${peakReport ?? "unknown"}`);
  }
}

main().catch((err) => {
  console.error(`audio equilibrium defective: ${err.message}`);
  process.exitCode = 1;
});
