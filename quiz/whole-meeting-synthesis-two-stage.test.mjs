import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { summarizeWholeMeetingArtifacts } from "../program/library/reporter_shared/whole-meeting-synthesis.mjs";
import {
  writePyaMapArtifact,
  readPyaMapArtifact,
  validateMeetingSummaryChunksStrict,
  validateMeetingSummaryArtifactStrict,
} from "../program/library/reporter_shared/agenda-stage-contracts.mjs";

test("whole-meeting synthesis writes chunk artifact and final summary from chunks", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "whole-meeting-two-stage-"));
  const meetingDir = path.join(tmpRoot, "2026-04-21_test-meeting_abc123");
  const transcriptDir = path.join(meetingDir, "transcript");
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(meetingDir, "meeting.json"),
    JSON.stringify({
      payload: {
        meeting_name: "Committee - Community Services",
        jurisdiction: "Owen Sound",
      },
    }),
    "utf8",
  );

  const sections = Array.from({ length: 6 }, (_, i) => ({
    index: i + 1,
    "unit id": `unit_${String(i + 1).padStart(3, "0")}`,
    "parent unit id": "",
    "part index": 0,
    "part total": 1,
    heading: `${i + 1} Heading`,
    summary: `Detailed source summary ${i + 1}. `.repeat(20).trim(),
    "chapter text": `Chapter ${i + 1}`,
    score: 0.95,
    mode: "llm-stage3",
    "source rows": 10,
    "start row": i * 10,
    "end row": i * 10 + 9,
    "max section seconds": 900,
    "grounding status": "grounded",
  }));

  writePyaMapArtifact(
    path.join(transcriptDir, "meeting-qwen-auto-normalized.agenda-summary.pya"),
    "agenda summary artifact",
    {
      "schema version": "agenda_summary_v1",
      "source section grounding": "fixture",
      "transcript dir": transcriptDir,
      prefix: "meeting-qwen-auto-normalized",
      focus: "newsworthy bits",
      "generated time": new Date().toISOString(),
      sections,
    },
  );

  const oldFetch = global.fetch;
  const oldTarget = process.env.MEETING_SUMMARY_STAGE_A_TARGET_BYTES;
  const oldHardMax = process.env.MEETING_SUMMARY_STAGE_A_HARD_MAX_BYTES;
  process.env.MEETING_SUMMARY_STAGE_A_TARGET_BYTES = "900";
  process.env.MEETING_SUMMARY_STAGE_A_HARD_MAX_BYTES = "1200";
  let chunkCalls = 0;
  let finalDraftCalls = 0;
  let finalScoreCalls = 0;

  global.fetch = async (_url, req) => {
    const body = JSON.parse(String(req?.body || "{}"));
    const prompt = String(body?.messages?.[1]?.content || "");
    let content = "";
    if (prompt.includes("Create a detailed chunk summary for whole-meeting synthesis.")) {
      chunkCalls += 1;
      content = `Chunk summary ${chunkCalls}: major topic, outcomes, follow-up, notable event.`;
    } else if (prompt.includes("Create a compelling whole-meeting local-news summary from chunk summaries.")) {
      finalDraftCalls += 1;
      content = [
        "# Whole Meeting Summary",
        "Opening summary sentence with context.",
        "",
        "## Top Newsworthy Developments",
        "Detailed section body with enough length to pass completeness checks. ".repeat(10).trim(),
        "",
        "## Why It Matters",
        "Why this matters for residents and local governance.",
        "",
        "## Watch Next",
        "What to monitor in upcoming meetings and implementation updates.",
      ].join("\n");
    } else if (prompt.includes("Score WHOLE_MEETING_SUMMARY for semantic faithfulness to CHUNK_SUMMARIES.")) {
      finalScoreCalls += 1;
      content = "FEEDBACK: Looks faithful.\nFINAL_SCORE: 0.95";
    } else {
      throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
    }
    return {
      ok: true,
      json: async () => ({ message: { content } }),
    };
  };

  try {
    const out = await summarizeWholeMeetingArtifacts({
      transcriptDirArg: transcriptDir,
      prefixArg: "meeting-qwen-auto-normalized",
      focusArg: "newsworthy bits",
      log: () => {},
    });
    assert.equal(out.chunkCount >= 1, true);
    assert.equal(chunkCalls, out.chunkCount);
    assert.equal(finalDraftCalls >= 1, true);
    assert.equal(finalScoreCalls >= 1, true);

    const chunksPath = path.join(transcriptDir, "meeting-qwen-auto-normalized.meeting-summary.chunks.pya");
    const summaryPyaPath = path.join(transcriptDir, "meeting-qwen-auto-normalized.meeting-summary.pya");
    const summaryMdPath = path.join(transcriptDir, "meeting-qwen-auto-normalized.meeting-summary.md");
    assert.equal(fs.existsSync(chunksPath), true);
    assert.equal(fs.existsSync(summaryPyaPath), true);
    assert.equal(fs.existsSync(summaryMdPath), true);

    const chunksArtifact = await readPyaMapArtifact(chunksPath, "meeting summary chunks artifact");
    const summaryArtifact = await readPyaMapArtifact(summaryPyaPath, "meeting summary artifact");
    validateMeetingSummaryChunksStrict(chunksArtifact);
    validateMeetingSummaryArtifactStrict(summaryArtifact, chunksArtifact);
    assert.equal(Array.isArray(chunksArtifact.chunks), true);
    assert.equal(chunksArtifact.chunks.length >= 1, true);
  } finally {
    global.fetch = oldFetch;
    if (oldTarget == null) delete process.env.MEETING_SUMMARY_STAGE_A_TARGET_BYTES;
    else process.env.MEETING_SUMMARY_STAGE_A_TARGET_BYTES = oldTarget;
    if (oldHardMax == null) delete process.env.MEETING_SUMMARY_STAGE_A_HARD_MAX_BYTES;
    else process.env.MEETING_SUMMARY_STAGE_A_HARD_MAX_BYTES = oldHardMax;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
