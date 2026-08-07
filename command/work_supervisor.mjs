#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { runWorkSupervisorOnce } from "../program/runtime/work/supervisor.mjs";

function value(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || fallback;
}

const args = process.argv.slice(2);
const worldRoot = path.resolve(value(args, "--world", process.env.PYA_WORLD_ROOT || "world"));
const repositoryRoot = path.resolve(value(args, "--repository", process.cwd()));
const owner = value(args, "--owner", process.env.PYA_WORK_OWNER || "");
const result = await runWorkSupervisorOnce({ worldRoot, repositoryRoot, owner });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status === "failed") process.exitCode = 1;
