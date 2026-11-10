import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { main as runCriterionCommand } from "../../command/criterion.mjs";
import { listCriterionRuns } from "../../program/runtime/criterion/run_index.mjs";
import { pyaFileToJson, pyaToPlainValue } from "../../program/library/pya_to_json.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pyash-criterion-runs-test-"));
}

async function writeRunManifest(root, run) {
  const directory = path.join(root, "criterion", "results");
  await fs.mkdir(directory, { recursive: true });
  const manifest = [
    `exists su name criterion ${run.runId} be map def`,
    `su name run id ob text ${JSON.stringify(run.runId)} be text ya`,
    `su name criterion name ob text ${JSON.stringify(run.criterion)} be text ya`,
    `su name suite name ob text ${JSON.stringify(run.suite.name)} be text ya`,
    `su name status ob text ${JSON.stringify(run.status)} be text ya`,
    `su name run payload ob text ${JSON.stringify(JSON.stringify(run))} be text ya`,
    "prah",
    ""
  ].join("\n");
  await fs.writeFile(path.join(directory, `${run.runId}.pya`), manifest, "utf8");
}

function plainFields(map) {
  return Object.fromEntries(Object.entries(map ?? {}).map(([key, value]) => [
    key,
    value?.ve ? value.ve.values : pyaToPlainValue(value)
  ]));
}

function fixtureRuns() {
  return [
    {
      runId: "meetingbank-qwen-older",
      criterion: "meetingbank-factuality-pilot",
      suite: { name: "MeetingBank factuality" },
      status: "partial",
      models: ["qwen3.5:9b"],
      selection: { count: 5 },
      machine: { hostname: "zvorygin" },
      startedAt: "2026-09-16T10:00:00.000Z",
      finishedAt: "2026-09-16T10:05:00.000Z"
    },
    {
      runId: "spark-meetingbank-newer",
      criterion: "meetingbank-factuality-pilot",
      suite: { name: "MeetingBank factuality" },
      status: "completed",
      models: ["SparkLLM/Spark-X2.6-4B:q4_k_m"],
      selection: { count: 10 },
      machine: { hostname: "mriczo" },
      startedAt: "2026-11-09T20:00:00.000Z",
      finishedAt: "2026-11-09T20:10:00.000Z"
    }
  ];
}

test("criterion runs discovers saved manifests and writes a parser-valid Pyash index", async () => {
  const root = await tempRoot();
  try {
    for (const run of fixtureRuns()) await writeRunManifest(root, run);

    const result = await listCriterionRuns({ root });
    assert.equal(result.totalRuns, 2);
    assert.equal(result.indexPath, path.join(root, "criterion", "results", "index.pya"));
    assert.deepEqual(result.runs.map(run => run.runId), ["spark-meetingbank-newer", "meetingbank-qwen-older"]);
    assert.equal(result.runs[0].host, "mriczo");
    assert.equal(result.runs[1].models[0], "qwen3.5:9b");
    assert.equal(result.runs[1].sampleCount, 5);
    assert.equal(result.runs[1].reportPath, "criterion/results/meetingbank-qwen-older.md");

    const parsed = await pyaFileToJson(result.indexPath);
    const catalog = parsed.memory.find(sentence => sentence.su?.name === "criterion run index");
    assert.ok(catalog);
    const catalogFields = plainFields(catalog.ob.map);
    assert.equal(catalogFields["run count"], 2);
    assert.deepEqual(catalogFields["run ids"], ["spark-meetingbank-newer", "meetingbank-qwen-older"]);

    const qwenEntry = parsed.memory.find(sentence => sentence.su?.name === "criterion run entry meetingbank-qwen-older");
    assert.ok(qwenEntry);
    const entryFields = plainFields(qwenEntry.ob.map);
    assert.equal(entryFields.benchmark, "MeetingBank factuality");
    assert.equal(entryFields.host, "zvorygin");
    assert.equal(entryFields.status, "partial");
    assert.deepEqual(entryFields.models, ["qwen3.5:9b"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("criterion runs filters by model, benchmark, status, host, and limit", async () => {
  const root = await tempRoot();
  try {
    for (const run of fixtureRuns()) await writeRunManifest(root, run);

    const result = await listCriterionRuns({
      root,
      model: "qwen3.5",
      benchmark: "meetingbank",
      status: "partial",
      host: "zvorygin",
      limit: 1
    });
    assert.equal(result.totalRuns, 2);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].runId, "meetingbank-qwen-older");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("criterion runs reports the Housekeeper target host for throughput records", async () => {
  const root = await tempRoot();
  try {
    const run = {
      runId: "spark-throughput-mriczo",
      criterion: "model-throughput",
      suite: { name: "Warm model generation throughput" },
      status: "completed",
      models: ["SparkLLM/Spark-X2.6-4B:q4_k_m"],
      aggregates: [{ aggregate: { sampleCount: 5 } }],
      machine: { hostname: "zvorygin" },
      throughput: { hostId: "mriczo" },
      startedAt: "2026-11-09T20:00:00.000Z"
    };
    await writeRunManifest(root, run);

    const result = await listCriterionRuns({ root, benchmark: "throughput" });
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].host, "mriczo");
    assert.equal(result.runs[0].sampleCount, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("criterion runs CLI prints the refreshed local index and matched reports", async () => {
  const root = await tempRoot();
  try {
    for (const run of fixtureRuns()) await writeRunManifest(root, run);

    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = chunk => { output += String(chunk); return true; };
    try {
      await runCriterionCommand(["criterion", "runs", "--model", "qwen", "--limit", "1"], { root });
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.match(output, /criterion\/results\/index\.pya/u);
    assert.match(output, /meetingbank-qwen-older/u);
    assert.doesNotMatch(output, /spark-meetingbank-newer/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
