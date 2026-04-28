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

  const schemaText = await fs.readFile(schemaPath, "utf8");
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
