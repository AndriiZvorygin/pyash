import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createCodingSaddleTrace } from "../program/agent/coding_saddle_trace.mjs";
import { recordMindJson, resetMindDebugCounters } from "../program/verbs/mind/logging.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { pyaFileToJson } from "../program/library/pya_to_json.mjs";
import { parse } from "../program/understand/index.mjs";

test("coding saddle records tool arguments and results as artifacts linked from its Pyash newspaper", async () => {
  const worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-trace-"));
  const cwd = path.join(worldRoot, "project");
  const now = new Date("2026-11-03T18:00:00.000Z");
  const trace = createCodingSaddleTrace({
    worldRoot,
    cwd,
    sessionName: "coding",
    sessionFile: path.join(worldRoot, "house", "coding saddle", "session", "coding.pya"),
    backend: "zai",
    model: "glm-5.3-flash",
    now,
    pid: 1234,
    runId: "test-saddle-run"
  });

  try {
    const turnId = trace.beginTurn({ input: "Inspect this test fixture." });
    const toolSentence = parse('be command ob text "printf trace-ok" to name text output do');
    const resultSentence = parse('su name command request 000001 ob text "trace-ok" be command ya');
    assert.equal(trace.recordToolEvent({
      stage: "call",
      toolName: "be_command_ob_text_to_name_text",
      toolSentence,
      toolCall: {
        id: "call-001",
        function: { name: "be_command_ob_text_to_name_text", arguments: JSON.stringify({ ob: "printf trace-ok" }) }
      }
    }), true);
    assert.equal(trace.recordToolEvent({
      stage: "result",
      toolName: "be_command_ob_text_to_name_text",
      toolSentence,
      toolCall: {
        id: "call-001",
        function: { name: "be_command_ob_text_to_name_text", arguments: JSON.stringify({ ob: "printf trace-ok" }) }
      },
      resultSentence,
      toolText: "trace-ok"
    }), true);
    trace.finishTurn({ status: "completed", sessionTurnId: "turn-session-001" });
    trace.close({ status: "closed" });

    const journal = await fs.readFile(trace.journalPath, "utf8");
    for (const sentence of splitSentences(journal, { includeThen: true })) {
      assert.doesNotThrow(() => parse(sentence.trim()), sentence);
    }
    assert.match(journal, /be artifact ya/u);
    assert.match(journal, /be tool ya/u);
    assert.match(journal, new RegExp(turnId, "u"));
    assert.match(journal, /tool-event-000001-call\.pya/u);
    assert.match(journal, /tool-event-000001-result\.pya/u);
    assert.match(journal, /turn-[^\s"]+-input\.pya/u);
    assert.match(journal, /turn-session-001/u);

    const callArtifact = await fs.readFile(path.join(worldRoot, "artifacts", trace.runId, "tool-event-000001-call.pya"), "utf8");
    const resultArtifact = await fs.readFile(path.join(worldRoot, "artifacts", trace.runId, "tool-event-000001-result.pya"), "utf8");
    assert.match(callArtifact, /printf trace-ok/u);
    assert.match(callArtifact, /call-001/u);
    assert.match(resultArtifact, /trace-ok/u);
  } finally {
    trace.close();
    await fs.rm(worldRoot, { recursive: true, force: true });
  }
});

test("coding saddle preserves a call artifact when its tool result never arrives", async () => {
  const worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-trace-partial-"));
  const cwd = path.join(worldRoot, "project");
  const trace = createCodingSaddleTrace({ worldRoot, cwd, runId: "partial-saddle-run" });
  try {
    trace.beginTurn({ input: "Run a command." });
    trace.recordToolEvent({
      stage: "call",
      toolName: "be_read_from_filename",
      toolCall: { id: "call-pending", function: { name: "be_read_from_filename", arguments: "{\"from\":\"README.md\"}" } }
    });
    trace.close({ status: "interrupted" });

    const artifact = await fs.readFile(path.join(worldRoot, "artifacts", trace.runId, "tool-event-000001-call.pya"), "utf8");
    const journal = await fs.readFile(trace.journalPath, "utf8");
    assert.match(artifact, /README\.md/u);
    assert.match(journal, /tool-event-000001-call\.pya/u);
    assert.match(journal, /interrupted/u);
  } finally {
    trace.close();
    await fs.rm(worldRoot, { recursive: true, force: true });
  }
});

test("coding saddle tracing allows Pyash writes inside the active project", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-trace-write-"));
  const worldRoot = path.join(tempRoot, "world");
  const cwd = path.join(tempRoot, "project");
  await fs.mkdir(cwd, { recursive: true });
  const outputPath = path.join(cwd, "chapter-note.txt");
  const trace = createCodingSaddleTrace({ worldRoot, cwd, runId: "saddle-project-write" });

  forget();
  try {
    trace.beginTurn({ input: "Write a project note." });
    const result = await interpret(parse(`ob text "written through Pyash" to filename "${outputPath}" be write do`));
    assert.equal(result.value.text, "written through Pyash");
    assert.equal(await fs.readFile(outputPath, "utf8"), "written through Pyash");

    const journal = await fs.readFile(trace.journalPath, "utf8");
    assert.match(journal, /chapter-note\.txt/u);
    const artifacts = await fs.readdir(path.join(worldRoot, "artifacts", trace.runId));
    assert.ok(artifacts.some((name) => name.includes("chapter-note.txt")));
    assert.equal(await fs.readFile(path.join(worldRoot, "newspaper", path.basename(trace.journalPath)), "utf8"), journal);
    await assert.rejects(fs.access(path.join(cwd, "artifacts")));
  } finally {
    trace.close();
    forget();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("coding saddle tracing records external house writes in its newspaper and artifact directory", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-trace-external-write-"));
  const worldRoot = path.join(tempRoot, "world");
  const cwd = path.join(tempRoot, "project");
  const houseRoot = path.join(tempRoot, "house");
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(houseRoot, { recursive: true });
  const outputPath = path.join(houseRoot, "MEMORY.md");
  const trace = createCodingSaddleTrace({ worldRoot, cwd, runId: "saddle-external-write" });

  forget();
  try {
    trace.beginTurn({ input: "Update the house memory file." });
    const result = await interpret(parse(`ob text "format-change record" to filename "${outputPath}" be write do`));
    assert.equal(result.value.text, "format-change record");
    assert.equal(await fs.readFile(outputPath, "utf8"), "format-change record");

    const journal = await fs.readFile(trace.journalPath, "utf8");
    assert.match(journal, /be artifact ya/u);
    assert.match(journal, /be exchange ya/u);
    assert.ok(journal.includes(outputPath));
    const artifacts = await fs.readdir(path.join(worldRoot, "artifacts", trace.runId));
    const alias = artifacts.find((name) => name.includes("MEMORY.md"));
    assert.ok(alias, "expected the external file artifact alias in the saddle run directory");
    assert.equal(await fs.readFile(path.join(worldRoot, "artifacts", trace.runId, alias), "utf8"), "format-change record");
  } finally {
    trace.close();
    forget();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("coding saddle trace rolls complete records into date-sequenced bounded files", async () => {
  const worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-trace-rotation-"));
  const newspaper = path.join(worldRoot, "newspaper");
  const trace = createCodingSaddleTrace({
    worldRoot,
    cwd: worldRoot,
    now: new Date("2026-11-10T18:00:00.000Z"),
    runId: "bounded-trace",
    segmentMaximumBytes: 700
  });
  try {
    for (let index = 0; index < 6; index += 1) {
      trace.beginTurn({ input: `turn ${index} ${"x".repeat(100)}` });
      trace.finishTurn({ status: "complete" });
    }
    trace.close();
    const names = (await fs.readdir(newspaper)).filter((name) => name.endsWith(".pya")).sort();
    assert.ok(names.length > 1);
    for (const name of names) {
      assert.match(name, /^20261110-\d{4}-coding-saddle\.pya$/u);
      const source = await fs.readFile(path.join(newspaper, name), "utf8");
      assert.ok(Buffer.byteLength(source) <= 700, `${name} exceeded its segment limit`);
      for (const sentence of splitSentences(source, { includeThen: true })) {
        assert.doesNotThrow(() => parse(sentence.trim()), `${name}: ${sentence}`);
      }
    }
    assert.equal(path.basename(trace.journalPath), names.at(-1));
  } finally {
    trace.close();
    await fs.rm(worldRoot, { recursive: true, force: true });
  }
});

test("coding saddle newspaper parses nested mind maps and multiline quoted content", async () => {
  const worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-trace-mind-json-"));
  const trace = createCodingSaddleTrace({ worldRoot, cwd: worldRoot, runId: "mind-json-trace" });
  resetMindDebugCounters();
  try {
    recordMindJson({
      targetName: "coding saddle regression",
      label: "request",
      payload: {
        messages: [{ role: "user", content: "first line\nquoted.text.inside.text.quoted\nlast line" }],
        tools: [{
          type: "function",
          function: { parameters: { type: "object", properties: { ob: { type: "string" } } } }
        }]
      }
    });
    trace.close();

    const parsed = await pyaFileToJson(trace.journalPath);
    const roleBoundaryMap = parsed.memory.find((sentence) =>
      sentence.su?.name === "coding saddle regression request 1 tools 1 function parameters properties ob"
    );
    assert.equal(roleBoundaryMap?.ob?.map?.type?.text, "string");
    const messageSeries = parsed.memory.find((sentence) =>
      sentence.su?.name === "coding saddle regression request 1 messages"
    );
    assert.equal(
      messageSeries?.ob?.series?.[0]?.ob?.text,
      "first line\nquoted.text.inside.text.quoted\nlast line"
    );
  } finally {
    resetMindDebugCounters();
    trace.close();
    forget();
    await fs.rm(worldRoot, { recursive: true, force: true });
  }
});
