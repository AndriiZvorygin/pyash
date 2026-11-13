#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mergeManagedCrontab } from "./watchdog-lib.mjs";

const currentRun = spawnSync("crontab", ["-l"], { encoding: "utf8" });
const current = currentRun.status === 0 ? currentRun.stdout : "";
const next = mergeManagedCrontab(current, { nodeBin: process.execPath });
if (next === current) {
  process.stdout.write("refinery watchdog crontab already current\n");
  process.exit(0);
}
const installed = spawnSync("crontab", ["-"], { input: next, encoding: "utf8" });
if (installed.status !== 0) {
  process.stderr.write(installed.stderr || "failed to install refinery watchdog crontab\n");
  process.exit(installed.status ?? 1);
}
process.stdout.write("installed refinery watchdog entries for the nightly reporters, hourly WordNet checks, and the Pyash-scheduled Kwon index refresh\n");
