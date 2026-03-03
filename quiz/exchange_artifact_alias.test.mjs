import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { clearExchangeRecorder, recordArtifact, setExchangeRecorder, setExchangeRunId } from "../program/bridge/exchange.mjs";

test("recordArtifact run aliases keep meaningful basename and extension", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-alias-"));
  const recorded = [];
  setExchangeRecorder({ record: (s) => recorded.push(s), runRoot });
  setExchangeRunId("run-001");
  try {
    const bytes = Buffer.from("demo-bytes", "utf8");
    const sentence = recordArtifact({
      locator: "examples/out/love-teaching.wav",
      producer: "exchange",
      bytes
    });
    assert.equal(sentence?.su?.name, "exchange-001");
    const aliasPath = path.join(runRoot, "artifacts", "run-001", "exchange-001-love-teaching.wav");
    const stat = await fs.stat(aliasPath);
    assert.ok(stat.size > 0);
  } finally {
    clearExchangeRecorder();
  }
});

test("recordArtifact producer names stay stable with deterministic suffixes", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-alias-"));
  const recorded = [];
  setExchangeRecorder({ record: (s) => recorded.push(s), runRoot });
  setExchangeRunId("run-002");
  try {
    const one = recordArtifact({ locator: "examples/out/a.wav", producer: "draw", bytes: Buffer.from("a") });
    const two = recordArtifact({ locator: "examples/out/b.wav", producer: "draw", bytes: Buffer.from("b") });
    assert.equal(one?.su?.name, "draw-001");
    assert.equal(two?.su?.name, "draw-002");
    await fs.stat(path.join(runRoot, "artifacts", "run-002", "draw-001-a.wav"));
    await fs.stat(path.join(runRoot, "artifacts", "run-002", "draw-002-b.wav"));
  } finally {
    clearExchangeRecorder();
  }
});

test("recordArtifact does not create duplicate run alias when locator is already in run folder", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-alias-"));
  setExchangeRecorder({ record: () => {}, runRoot });
  setExchangeRunId("run-003");
  try {
    const locator = "artifacts/run-003/draw/draw-platform-cut-001.png";
    const bytes = Buffer.from("img", "utf8");
    const originalPath = path.join(runRoot, locator);
    await fs.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.writeFile(originalPath, bytes);
    recordArtifact({ locator, producer: "draw platform", bytes });
    const originalStat = await fs.stat(originalPath);
    assert.ok(originalStat.size > 0);

    const runDir = path.join(runRoot, "artifacts", "run-003");
    const names = await fs.readdir(runDir);
    const duplicateAlias = names.find((name) => /^draw-platform-\d{3}-draw-platform-cut-001\.png$/.test(name));
    assert.equal(duplicateAlias, undefined);
  } finally {
    clearExchangeRecorder();
  }
});

test("recordArtifact materializes run-folder locator when missing", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-alias-"));
  setExchangeRecorder({ record: () => {}, runRoot });
  setExchangeRunId("run-004");
  try {
    const locator = "artifacts/run-004/newspaper/text-000001.txt";
    const bytes = Buffer.from("hello-newspaper", "utf8");
    recordArtifact({ locator, producer: "newspaper", bytes });
    const materialized = await fs.readFile(path.join(runRoot, locator), "utf8");
    assert.equal(materialized, "hello-newspaper");
  } finally {
    clearExchangeRecorder();
  }
});
