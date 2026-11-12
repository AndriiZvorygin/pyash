#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWordNetSenseCompoundRefinerySweepCommand } from "../../../../command/wordnet_sense_compound_refinery.mjs";
import { readPyaTextValues } from "../../../../program/library/pya_config.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_ROOT = path.resolve(PROGRAM_DIR, "..");
const CONFIG_PATH = path.join(HOUSE_ROOT, "conduct", "wordnet-sweep-recovery.pya");
const runId = String(readPyaTextValues(CONFIG_PATH, ["WordNet sweep run id"])["WordNet sweep run id"] || "").trim();
if (!runId) throw new Error(`WordNet sweep run id is missing from ${CONFIG_PATH}`);

for (const name of Object.keys(process.env)) {
  if (name === "PYA_MIND_RESPONSE" || /^PYA_.*FIXTURE$/u.test(name)) delete process.env[name];
}

await runWordNetSenseCompoundRefinerySweepCommand({ runId });
