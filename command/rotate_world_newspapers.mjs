#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rotateWorldNewspapers } from "../program/agent/newspaper_retention.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const args = process.argv.slice(2);
  if (args.some((value) => value === "--help" || value === "-h")) {
    process.stdout.write("Usage: node command/rotate_world_newspapers.mjs [--apply]\n");
    return;
  }
  if (args.some((value) => value !== "--apply")) throw new Error(`unknown argument: ${args.find((value) => value !== "--apply")}`);
  const apply = args.includes("--apply");
  const result = await rotateWorldNewspapers({ configRoot: repoRoot, worldRoot: path.join(repoRoot, "world"), apply });
  process.stdout.write(`[newspaper rotation] mode=${apply ? "apply" : "plan"} total_before=${result.beforeBytes} retained=${result.retainedBytes} max=${result.maximumBytes} segment_max=${result.segmentMaximumBytes}\n`);
  if (apply) process.stdout.write(`[newspaper rotation] removed=${result.removedBytes} parts=${result.generatedParts}\n`);
  else process.stdout.write("[newspaper rotation] plan only; pass --apply to rotate and prune these newspaper logs\n");
}

main().catch((error) => {
  process.stderr.write(`[newspaper rotation] error: ${String(error?.stack || error?.message || error)}\n`);
  process.exitCode = 1;
});
