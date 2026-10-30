#!/usr/bin/env node

// Per-file quiz sweep: runs every quiz file on its own and records the outcome.
// Used to derive the resource tier manifest (Phase 3.1) from observed
// behaviour rather than from guesswork about markers in the source.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function testFilesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && /\.test\.mjs$/u.test(entry.name)) files.push(fullPath);
    }
  };
  visit(directory);
  return files;
}

const files = testFilesUnder(path.join(root, "quiz")).sort();

const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const selected = only.length > 0
  ? files.filter((file) => only.some((needle) => file.includes(needle)))
  : files;

const results = [];

for (const file of selected) {
  const relative = path.relative(root, file);
  const outcome = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", file], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYASH_INCLUDE_HOUSE_TESTS: "0" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", () => resolve({ status: "error", detail: "spawn failed" }));
    child.on("exit", (code) => {
      const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gmu)].map((m) => m[1].trim());
      resolve({
        status: code === 0 ? "passed" : "failed",
        detail: failures.join(" | "),
      });
    });
  });
  results.push({ file: relative, ...outcome });
  const marker = outcome.status === "passed" ? "ok  " : "FAIL";
  console.log(`${marker} ${relative}${outcome.detail ? ` :: ${outcome.detail}` : ""}`);
}

const failed = results.filter((result) => result.status !== "passed");
console.log(`\nsweep: ${results.length - failed.length} passed, ${failed.length} failed`);

fs.writeFileSync(
  path.join(root, "artifacts", "quiz-sweep.json"),
  `${JSON.stringify({ results, failed: failed.length }, null, 2)}\n`,
  "utf8",
);
