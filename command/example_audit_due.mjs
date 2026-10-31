#!/usr/bin/env node
// Decide whether the example audit is due.
//
// The audit runs every example through the real runner, one process per
// example, and takes about twelve minutes. It is therefore not a per-change
// check: it runs monthly, and on a push once a hundred commits have landed
// since the last audit, whichever comes first.
//
// Usage: node command/example_audit_due.mjs [--event push] [--last <sha>] [--threshold N]
// Prints "run=true" or "run=false" on the first line, and the reason below.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The cadence: a hundred commits, or a month, whichever comes first.
export const DEFAULT_COMMIT_THRESHOLD = 100;

// Decide from the facts alone, so the rule can be tested without a git
// repository and without a network.
//
// An unknown last audit is not a reason to skip: the audit runs instead. A
// skip that cannot be justified is a silent gap in the coverage.
export function decideAuditDue({ event = "push", last = "", commitsSince = null, threshold = DEFAULT_COMMIT_THRESHOLD } = {}) {
  if (event !== "push") {
    return { run: true, reason: "the audit runs on the monthly schedule and on demand" };
  }
  if (!last) {
    return { run: true, reason: "no earlier audit is recorded, so the audit runs" };
  }
  if (commitsSince === null) {
    return { run: true, reason: "the commits since the last audit could not be counted, so the audit runs" };
  }
  if (commitsSince >= threshold) {
    return { run: true, reason: `${commitsSince} commits have landed since the last audit, which is the threshold` };
  }
  return { run: false, reason: `only ${commitsSince} commits have landed since the last audit, so the audit is not due yet` };
}

// Count the commits that landed since the given commit.
//
// The count is null when the commit is not on this branch: a rewritten
// history means the distance cannot be measured, and the audit runs.
export function countCommitsSince(last) {
  if (!last) return null;
  try {
    execFileSync("git", ["cat-file", "-e", `${last}^{commit}`], { cwd: root, stdio: "ignore" });
  } catch {
    return null;
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", last, "HEAD"], { cwd: root, stdio: "ignore" });
  } catch {
    return null;
  }
  try {
    const out = execFileSync("git", ["rev-list", "--count", `${last}..HEAD`], { cwd: root, encoding: "utf8" });
    return Number(String(out).trim());
  } catch {
    return null;
  }
}

function flagValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export function main(argv = process.argv.slice(2)) {
  const event = argv.includes("--event") ? flagValue("--event", "push") : "push";
  const last = flagValue("--last", "");
  const threshold = Number(flagValue("--threshold", String(DEFAULT_COMMIT_THRESHOLD)));
  const verdict = decideAuditDue({
    event,
    last,
    commitsSince: countCommitsSince(last),
    threshold
  });
  console.log(`run=${verdict.run}`);
  console.log(verdict.reason);
  return verdict;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
