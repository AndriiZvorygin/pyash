import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import {
  renderVliwConformancePya,
  writeVliwConformancePya
} from "../command/vliw_conformance_report.mjs";

test("VLIW conformance report records CPU/GPU timings and artifact identity as Pyash", () => {
  const source = renderVliwConformancePya({
    runId: "20261119-0001",
    status: "passed",
    startedAt: "2026-11-19T17:00:00.000Z",
    finishedAt: "2026-11-19T17:00:01.000Z",
    totalWallMs: 1000,
    cpuRequests: [{ name: "codelets", phase: "cpu-request", elapsedMs: 12.5, packBytes: 400, caseCount: 26 }],
    gpuRequests: [{
      name: "programlets",
      phase: "gpu-request",
      elapsedMs: 650,
      packBytes: 900,
      caseCount: 18,
      housekeeper: {
        handleId: "job-1",
        queueWaitMs: 100,
        activeMs: 500,
        clientRoundTripMs: 650
      }
    }],
    passedCases: ["scalar-arithmetic"],
    expectedErrors: [{ name: "division-by-zero", errorCode: 2 }],
    environment: {
      hostname: "mriczo",
      sourceRevision: "abc123",
      cpuExecutable: { path: "/tmp/vliw_reference", sizeBytes: 1234, sha256: "a".repeat(64) },
      gpuInfo: "RTX 3090, 550.163.01, 24576 MiB",
      gpu: {
        pipeline: { scope: "runtime-cache-load", fullInitializationSeconds: 0.87, perPipelineSeconds: { pack: 0.23 } },
        artifacts: { "spirv shader": { path: "/service/shader.spv", sizeBytes: 456, sha256: "b".repeat(64) } }
      }
    }
  });
  const sentences = source.trim().split("\n").map((line) => parse(line));
  assert.equal(sentences.every(Boolean), true, "every report row is a valid Pyash sentence");
  assert.equal(sentences.some(({ su, ob }) => su?.name === "cpu request 01 wall ms" && ob?.num === 12.5), true);
  assert.equal(sentences.some(({ su, ob }) => su?.name === "gpu request 01 active ms" && ob?.num === 500), true);
  assert.equal(sentences.some(({ su, ob }) => su?.name === "spirv shader bytes" && ob?.num === 456), true);
  assert.equal(sentences.some(({ su, ob }) => su?.name === "expected error 01 code" && ob?.num === 2), true);
});

test("VLIW conformance reports are written under a dated artifacts run directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vliw-report-"));
  try {
    const reportPath = await writeVliwConformancePya(root, { status: "passed" }, new Date("2026-11-19T17:00:00.000Z"));
    assert.match(path.relative(root, reportPath), /^artifacts\/20261119-0001-rust-vliw-conformance\/result\.pya$/u);
    const source = await fs.readFile(reportPath, "utf8");
    assert.equal(parse(source.trim())?.ob?.text, "passed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
