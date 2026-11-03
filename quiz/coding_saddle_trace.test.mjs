import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createCodingSaddleTrace } from "../program/agent/coding_saddle_trace.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
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
  const trace = createCodingSaddleTrace({ worldRoot, runId: "partial-saddle-run" });
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
