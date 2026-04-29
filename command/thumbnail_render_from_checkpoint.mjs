#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

function usage() {
  return [
    "Usage:",
    "  node command/thumbnail_render_from_checkpoint.mjs <schema-source.txt> <output.png> [workflow] [host] [width] [height]"
  ].join("\n");
}

function runNodeScript(scriptPath, args = [], { input = "" } = {}) {
  const result = spawnSync("node", [scriptPath, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr || `command failed: node ${scriptPath}`);
  }
  return String(result.stdout || "").trim();
}

function escapeSchemaValue(value = "") {
  return String(value ?? "").replace(/\r?\n/gu, " ").replace(/\s+/gu, " ").trim();
}

function mapEntryText(entry = {}) {
  if (!entry || typeof entry !== "object") return "";
  const ob = entry.ob && typeof entry.ob === "object" ? entry.ob : {};
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.filename === "string") return ob.filename;
  if (typeof ob.num === "number") return String(ob.num);
  if (typeof ob.bool === "boolean") return ob.bool ? "truth" : "lie";
  return "";
}

function checkpointPyaToSchemaText(pyaText = "") {
  const text = String(pyaText ?? "");
  if (!/su\s+name\s+thumbnail\s+checkpoint\s+be\s+map\s+def/iu.test(text)) {
    throw new Error("thumbnail render defective: checkpoint map missing");
  }
  const required = [
    "HOOK_SUBJECT",
    "EMOTION",
    "FRAMING",
    "BACKGROUND",
    "OVERLAY_TEXT",
    "COLOUR_CONTRAST",
    "STYLE",
    "CLARITY_RULES",
    "NEGATIVE_PROMPT"
  ];
  const lines = [];
  for (const key of required) {
    const pattern = new RegExp(`^\\s*su\\s+name\\s+${key}\\s+ob\\s+text\\s+\"([\\s\\S]*?)\"\\s+ya\\s*$`, "m");
    const match = text.match(pattern);
    const value = escapeSchemaValue((match?.[1] ?? "").replace(/\\\\n/gu, " "));
    if (!value) throw new Error(`thumbnail render defective: checkpoint missing ${key}`);
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

async function main() {
  const [schemaPathArg, outputPathArg, workflowArg, hostArg, widthArg, heightArg] = process.argv.slice(2);
  if (!schemaPathArg || !outputPathArg) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const schemaPath = path.resolve(schemaPathArg);
  const outputPath = path.resolve(outputPathArg);
  const workflow = String(workflowArg || "Z-Image-TSV");
  const host = String(hostArg || "http://localhost:8188");
  const width = Number(widthArg || 1280);
  const height = Number(heightArg || 720);

  const schemaTextRaw = await fs.readFile(schemaPath, "utf8");
  const schemaText = path.extname(schemaPath).toLowerCase() === ".pya"
    ? checkpointPyaToSchemaText(schemaTextRaw)
    : schemaTextRaw;
  const composedPrompt = runNodeScript("command/thumbnail_prompt_compose.mjs", [], { input: schemaText });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const drawOut = runNodeScript("command/draw_comfyui_runner.mjs", [
    "--prompt-stdin",
    "--workflow-name", workflow,
    "--host", host,
    "--width", String(width),
    "--height", String(height),
    "--output", outputPath
  ], { input: composedPrompt });

  if (!drawOut) {
    throw new Error("thumbnail render defective: draw runner produced no output path");
  }

  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
