#!/usr/bin/env node

// Runs the quiz suite by resource tier.
//
// The gating policy lives in configure/test_tiers.pya so it is part of the
// Pyash configuration rather than a command-line switch. A quiz that needs a
// resource this machine does not have is reported with the reason instead of
// failing the run: the environment is missing something, the code is not
// broken. In CI the resources are provisioned, so those quizzes gate there.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readPyaTextValues } from "../program/library/pya_config.mjs";
import { classifyQuizFile } from "./quiz_tiers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyFile = path.join(root, "configure", "test_tiers.pya");

const policy = readPyaTextValues(policyFile, ["ci_gating_tiers", "ci_advisory_tiers"]);
const gatingTiers = new Set(
  String(policy.ci_gating_tiers || "t1,t2")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

function trackedQuizFiles() {
  const output = execFileSync("git", ["ls-files", "quiz"], { cwd: root, encoding: "utf8" });
  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => file.endsWith(".test.mjs"))
    .sort();
}

function houseIsTracked(house) {
  const output = execFileSync("git", ["ls-files", `world/house/${house}`], {
    cwd: root,
    encoding: "utf8"
  });
  return output.trim().length > 0;
}

const resourceChecks = {
  wordnet: () =>
    fs.existsSync(path.join(root, "know", "wordnet", "open-english-wordnet-2025-json", "entries-a.json")),
  whisper: () => fs.existsSync(path.join(root, "caterer", "whisper.cpp", "samples", "jfk.wav")),
  "ffmpeg-drawtext": () => {
    try {
      const output = execFileSync("ffmpeg", ["-hide_banner", "-filters"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      return /\bdrawtext\b/u.test(output);
    } catch {
      return false;
    }
  },
  house: (house) => fs.existsSync(path.join(root, "world", "house", house))
};

function missingRequirements(requirements) {
  return requirements.filter((requirement) => {
    const check = resourceChecks[requirement.id];
    if (!check) return true;
    return !check(requirement.detail);
  });
}

const files = trackedQuizFiles();
const classified = files.map((file) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  return { file, ...classifyQuizFile(source, { isTrackedHouse: houseIsTracked }) };
});

const gated = [];
const notGated = [];
for (const entry of classified) {
  const missing = missingRequirements(entry.requirements);
  if (!gatingTiers.has(entry.tier)) {
    notGated.push({ ...entry, reason: `tier ${entry.tier} is advisory` });
  } else if (missing.length > 0) {
    const names = missing.map((requirement) => `${requirement.id} (${requirement.detail})`).join(", ");
    notGated.push({ ...entry, reason: `missing ${names}` });
  } else {
    gated.push(entry);
  }
}

const byTier = new Map();
for (const entry of classified) {
  byTier.set(entry.tier, (byTier.get(entry.tier) || 0) + 1);
}

console.log("quiz tiers (policy: configure/test_tiers.pya)");
for (const tier of ["t1", "t2", "t3"]) {
  const count = byTier.get(tier) || 0;
  console.log(`  ${tier}  ${String(count).padStart(4)} files${gatingTiers.has(tier) ? "  (gating)" : "  (advisory)"}`);
}
console.log(`  gating ${gated.length} files, reporting ${notGated.length} without gating`);
if (notGated.length > 0) {
  console.log("");
  console.log("not gated in this environment:");
  for (const entry of notGated) {
    console.log(`  ${entry.file}  :: ${entry.reason}`);
  }
}
console.log("");

const child = spawn(process.execPath, ["--test", ...gated.map((entry) => entry.file)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYASH_INCLUDE_HOUSE_TESTS: "0" }
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
