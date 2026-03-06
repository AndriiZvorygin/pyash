import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";
import {
  runAndroidOnce,
  runAndroidPollOnce,
  runAndroidInputOnce,
  runAndroidProduceOnce
} from "../program/agent/android/index.mjs";

function usage() {
  return "Usage: node command/android_run.mjs --once [--phase poll|input|produce|all] [--world <path>]";
}

async function initializeRuntime({ cwd }) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) {
    registerSignatureHandler(sig);
  }
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
  if (!remember("mricge")) {
    await interpret(parse("exists su name mricge be mind ya"));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once") || !args.includes("--watch");
  const phase = String(readFlagValue(args, "--phase") ?? "all").trim().toLowerCase();
  const worldArg = readFlagValue(args, "--world");

  if (!once) {
    console.error("android_run: only --once mode is currently supported");
    console.error(usage());
    process.exit(1);
  }

  await initializeRuntime({ cwd: process.cwd() });
  const worldRoot = worldArg
    ? path.resolve(worldArg)
    : (resolveWorldRoot({ rememberFn: remember }) ?? path.resolve(process.cwd(), "world"));

  let result = null;
  if (phase === "poll" || phase === "probe") {
    result = await runAndroidPollOnce({ worldRoot });
  } else if (phase === "input") {
    result = await runAndroidInputOnce({ worldRoot, maxItems: 20 });
  } else if (phase === "produce") {
    result = await runAndroidProduceOnce({ worldRoot, maxItems: 20 });
  } else if (phase === "all" || !phase) {
    result = await runAndroidOnce({ worldRoot, inputMaxItems: 20, produceMaxItems: 20 });
  } else {
    console.error(`android_run: unsupported phase ${JSON.stringify(phase)}`);
    console.error(usage());
    process.exit(1);
  }

  console.log(`android ${phase}: received=${Number(result?.received ?? 0)} handled=${Number(result?.handled ?? 0)} sent=${Number(result?.sent ?? 0)} queue=${Number(result?.queueDepth ?? 0)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
