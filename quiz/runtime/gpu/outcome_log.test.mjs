import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { splitSentences } from "../../../program/library/sentenceSplitter.mjs";
import { parse } from "../../../program/understand/index.mjs";
import { gpuOutcomeLogPath, appendGpuOutcome } from "../../../program/runtime/gpu/outcome_log.mjs";

test("gpu outcome log path returns expected world/newspaper shape", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-outcome-path-"));
  const worldRoot = path.join(root, "world");
  const target = gpuOutcomeLogPath(worldRoot, { agentName: "Agent Prime" });
  assert.match(target, /world\/newspaper\/\d{8}-gpu-agent-prime\.pya$/);
});

test("gpu append outcome creates expected daily log file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-outcome-create-"));
  const worldRoot = path.join(root, "world");
  await appendGpuOutcome(worldRoot, {
    agentName: "agent-a",
    handleId: "job-1",
    intent: "verify",
    outcome: "queued",
    gpuId: "gpu-0",
    message: "queued",
    timestamp: "2026-03-03T10:00:00.000Z"
  });
  const target = gpuOutcomeLogPath(worldRoot, { agentName: "agent-a" });
  const text = await fs.readFile(target, "utf8");
  assert.match(text, /be gpu outcome/);
  assert.match(text, /job-1/);
});

test("gpu append outcome appends multiple sentences rather than overwriting", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-outcome-append-"));
  const worldRoot = path.join(root, "world");
  await appendGpuOutcome(worldRoot, {
    agentName: "agent-a",
    handleId: "job-1",
    intent: "verify",
    outcome: "running",
    gpuId: "gpu-0",
    message: "running",
    timestamp: "2026-03-03T10:00:01.000Z"
  });
  await appendGpuOutcome(worldRoot, {
    agentName: "agent-a",
    handleId: "job-1",
    intent: "verify",
    outcome: "success",
    gpuId: "gpu-0",
    message: "done",
    timestamp: "2026-03-03T10:00:02.000Z"
  });
  const target = gpuOutcomeLogPath(worldRoot, { agentName: "agent-a" });
  const text = await fs.readFile(target, "utf8");
  const sentences = splitSentences(text).filter(Boolean);
  assert.equal(sentences.length, 2);
});

test("gpu append outcome writes default timestamp when omitted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-outcome-default-time-"));
  const worldRoot = path.join(root, "world");
  await appendGpuOutcome(worldRoot, {
    agentName: "agent-a",
    handleId: "job-2",
    intent: "verify",
    outcome: "status",
    gpuId: "gpu-0",
    message: "status"
  });
  const target = gpuOutcomeLogPath(worldRoot, { agentName: "agent-a" });
  const text = await fs.readFile(target, "utf8");
  const sentences = splitSentences(text).filter(Boolean);
  assert.equal(sentences.length, 1);
  const parsed = parse(sentences[0]);
  assert.ok(parsed?.during?.date);
  assert.ok(Number.isFinite(Date.parse(String(parsed?.during?.date))));
});

test("gpu append outcome uses safe fallback when agent name is empty", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-outcome-agent-fallback-"));
  const worldRoot = path.join(root, "world");
  await appendGpuOutcome(worldRoot, {
    agentName: "",
    handleId: "job-3",
    intent: "verify",
    outcome: "fail",
    gpuId: "gpu-0",
    message: "failed",
    timestamp: "2026-03-03T10:00:03.000Z"
  });
  const target = gpuOutcomeLogPath(worldRoot, { agentName: "" });
  assert.match(target, /-gpu-agent\.pya$/);
  const text = await fs.readFile(target, "utf8");
  const parsed = parse(splitSentences(text).filter(Boolean)[0]);
  assert.equal(parsed?.for?.text, "agent");
});
