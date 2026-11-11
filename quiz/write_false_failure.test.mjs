import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { clearExchangeRecorder, setExchangeRecorder, setExchangeRunId } from "../program/bridge/exchange.mjs";
import write from "../program/verbs/exchange/write.mjs";

test("write succeeds when post-write exchange recording fails", async () => {
  const previousCwd = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-bookkeeping-"));
  const previousConsoleError = console.error;
  const warnings = [];
  process.chdir(tempRoot);
  console.error = (...args) => warnings.push(args.join(" "));
  setExchangeRecorder({
    runRoot: tempRoot,
    record() {
      throw new Error("simulated exchange recorder failure");
    }
  });

  try {
    const result = await write({
      ob: { text: "B1 content includes its own B1 anchor prefix" },
      to: { filename: "note.txt" }
    }, { remember: () => undefined });

    assert.equal(await fs.readFile(path.join(tempRoot, "note.txt"), "utf8"), "B1 content includes its own B1 anchor prefix");
    assert.equal(result.be, "write");
    assert.equal(result.ob.text, "B1 content includes its own B1 anchor prefix");
    assert.match(warnings.join("\n"), /file saved at .*; exchange bookkeeping failed/u);
  } finally {
    clearExchangeRecorder();
    console.error = previousConsoleError;
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("write to a valid path outside the exchange run root does not report a false failure", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-run-root-"));
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-external-"));
  const previousConsoleError = console.error;
  const warnings = [];
  const records = [];
  const target = path.join(externalRoot, "MEMORY.md");
  console.error = (...args) => warnings.push(args.join(" "));
  setExchangeRecorder({ runRoot: projectRoot, artifactRoot: projectRoot, record: (sentence) => records.push(sentence) });
  setExchangeRunId("external-write-run");

  try {
    const result = await write({
      ob: { text: "format-change record" },
      to: { filename: target }
    }, { remember: () => undefined });

    assert.equal(await fs.readFile(target, "utf8"), "format-change record");
    assert.equal(result.be, "write");
    const artifact = records.find((sentence) => sentence.be === "artifact");
    assert.equal(artifact?.to?.filename, target);
    assert.ok(records.some((sentence) => sentence.be === "exchange" && sentence.as?.name === "write"));
    assert.equal(await fs.readFile(path.join(projectRoot, "artifacts", "external-write-run", `${artifact.su.name}-MEMORY.md`), "utf8"), "format-change record");
    assert.deepEqual(warnings, []);
  } finally {
    clearExchangeRecorder();
    console.error = previousConsoleError;
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(externalRoot, { recursive: true, force: true });
  }
});

test("write retry records an artifact after an earlier journal failure", async () => {
  const previousCwd = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-retry-"));
  const previousConsoleError = console.error;
  let failRecording = true;
  const recorded = [];
  process.chdir(tempRoot);
  console.error = () => undefined;
  setExchangeRecorder({
    runRoot: tempRoot,
    record(sentence) {
      if (failRecording) throw new Error("simulated transient journal failure");
      recorded.push(sentence);
    }
  });

  try {
    await write({ ob: { text: "saved before journal recovery" }, to: { filename: "note.txt" } }, { remember: () => undefined });
    failRecording = false;
    const result = await write({ ob: { text: "saved before journal recovery" }, to: { filename: "note.txt" } }, { remember: () => undefined });

    assert.equal(result.be, "write");
    assert.ok(recorded.some(sentence => sentence.be === "artifact" && sentence.to?.filename === "note.txt"));
  } finally {
    clearExchangeRecorder();
    console.error = previousConsoleError;
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
