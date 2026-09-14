#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { enqueueWorkTask } from "../program/runtime/work/queue.mjs";
import { readWorkTaskStatus } from "../program/runtime/work/status.mjs";
import { runWorkSupervisorOnce } from "../program/runtime/work/supervisor.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync("git", args, { cwd, maxBuffer: 2 * 1024 * 1024 });
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-real-work-smoke-"));
  const repositoryRoot = path.join(root, "fixture");
  const worldRoot = path.join(root, "world");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await fs.mkdir(worldRoot, { recursive: true });
  await git(repositoryRoot, ["init", "-q"]);
  await git(repositoryRoot, ["config", "user.email", "pyash-smoke@example.invalid"]);
  await git(repositoryRoot, ["config", "user.name", "Pyash Smoke"]);
  await fs.writeFile(
    path.join(repositoryRoot, "test.mjs"),
    "import assert from \"node:assert/strict\";\nimport fs from \"node:fs\";\nassert.equal(fs.readFileSync(\"greeting.txt\", \"utf8\").trim(), \"hello from luna\");\n",
    "utf8"
  );
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-qm", "smoke fixture"]);

  const taskId = "real-supervisor-smoke";
  await enqueueWorkTask(worldRoot, {
    taskId,
    owner: "smoke",
    kind: "smoke",
    title: "Create the greeting fixture",
    acceptanceText: "greeting.txt contains exactly hello from luna and node test.mjs passes.",
    promptText: "Create greeting.txt with the required greeting, then run node test.mjs.",
    contextText: "This is an isolated real Codex App Server acceptance test.",
    retryMax: 0
  });

  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot,
    owner: "smoke",
    workerTag: "real-smoke",
    threadSandbox: "danger-full-access",
    turnSandboxPolicy: { type: "dangerFullAccess" }
  });
  const status = await readWorkTaskStatus(worldRoot, taskId);
  const output = {
    root,
    repositoryRoot,
    worldRoot,
    result,
    status: status?.status,
    checkpoint: status?.checkpoint
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (status?.status !== "accepted") {
    throw new Error(`real supervisor smoke did not reach accepted: ${status?.status || "missing"}`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exitCode = 1;
});
