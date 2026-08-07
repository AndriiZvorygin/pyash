import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  adjudicateChunkReview,
  adjudicateFinalReviews,
  auditFinalChunkCoverage,
  buildChunkRetryGuidance,
  buildFinalNumericGroundingSource,
  governingBodyDefects,
  namedCouncilActorDefects,
  previewTemporalDefects,
  summarizeWholeMeetingArtifacts,
} from "../program/library/reporter_shared/whole-meeting-synthesis.mjs";
import { unsupportedNumericTokens } from "../program/library/reporter_shared/grounded-numeric-fidelity.mjs";
import {
  writePyaMapArtifact,
  readPyaMapArtifact,
  validateMeetingSummaryChunksStrict,
  validateMeetingSummaryArtifactStrict,
} from "../program/library/reporter_shared/agenda-stage-contracts.mjs";

test("upcoming whole-meeting validation rejects completed-meeting framing", () => {
  const defects = previewTemporalDefects([
    "On July 27, Owen Sound Council convened to review the capital plan.",
    "The session prioritized infrastructure funding.",
    "The afternoon also saw staff present shelter data.",
  ].join(" "));
  assert.deepEqual(defects, [
    "Council convened",
    "The session prioritized",
    "The afternoon also saw",
  ]);
  assert.deepEqual(
    previewTemporalDefects("The July 27 agenda says Council will consider the capital plan and shelter proposal."),
    [],
  );
});

test("whole-meeting validation rejects acting-body substitution", () => {
  assert.deepEqual(
    governingBodyDefects(
      "Council members expressed support and Council approved the application.",
      "Committee of the Whole",
    ),
    ["Council members expressed support", "Council approved"],
  );
  assert.deepEqual(
    governingBodyDefects(
      "The Committee of the Whole considered the application.",
      "Committee of the Whole",
    ),
    [],
  );
  assert.deepEqual(
    governingBodyDefects(
      "The Operations Committee approved the recommendation before Council received its minutes.",
      "Council Meeting - Regular",
      "The Operations Committee approved the recommendation.",
    ),
    [],
  );
  assert.deepEqual(
    governingBodyDefects(
      "The Operations Committee approved the recommendation.",
      "Council Meeting - Regular",
      "The Operations Committee discussed the recommendation.",
    ),
    ["Committee approved"],
  );
});

test("chunk validation distinguishes a chair role from a named chair", () => {
  assert.deepEqual(
    namedCouncilActorDefects("The chair called the meeting to order and outlined the agenda."),
    [],
  );
  assert.deepEqual(
    namedCouncilActorDefects("Chair Morgan called the meeting to order. Alex Morgan moved the motion."),
    ["Chair Morgan", "Alex Morgan moved"],
  );
  assert.deepEqual(
    namedCouncilActorDefects(
      "- 3.a Notice provided by Councillor Greig: The committee considered the notice.",
      ["3.a Notice provided by Councillor Greig"],
    ),
    [],
  );
  assert.deepEqual(
    namedCouncilActorDefects(
      "- 3.a Notice provided by Councillor Greig: Councillor Greig asked for a review.",
      ["3.a Notice provided by Councillor Greig"],
    ),
    ["Councillor Greig"],
  );
});

test("chunk retry guidance includes the rejected draft and every rejection reason", () => {
  const guidance = buildChunkRetryGuidance({
    candidate: "Chair Morgan adopted all three motions.",
    forbiddenNames: ["Chair Morgan"],
    wrongBody: ["Committee approved"],
    bodyLabel: "Council Meeting - Regular",
    semanticReview: "FINAL_SCORE: 0.52\nFEEDBACK: Three separate motions were collapsed.",
  });
  assert.match(guidance, /REJECTED_DRAFT:\s*Chair Morgan adopted all three motions\./u);
  assert.match(guidance, /Remove named councillors\/movers: Chair Morgan\./u);
  assert.match(guidance, /Use only "Council Meeting - Regular" as the acting body/u);
  assert.match(guidance, /Three separate motions were collapsed/u);
  assert.match(guidance, /Revise the rejected draft/u);
});

test("chunk retry guidance varies repeated actor-defect instructions", () => {
  const guidance = buildChunkRetryGuidance({
    candidate: "The body met while Councillor Morgan was absent.",
    forbiddenNames: ["Councillor Morgan"],
    bodyLabel: "Council Meeting - Regular",
    attempt: 3,
  });
  assert.match(guidance, /third-pass repair/iu);
  assert.match(guidance, /Delete every listed named-actor occurrence/iu);
  assert.match(guidance, /Scan the full corrected draft/iu);
  assert.match(guidance, /write a fresh summary from the grounded source/iu);
  assert.doesNotMatch(guidance, /Revise the rejected draft below/iu);
  assert.match(guidance, /Councillor Morgan/u);
});

test("chunk review adjudication checks an alleged outcome against literal evidence", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: "FINAL SCORE: 0.92\nFEEDBACK: The source does not state a final zoning outcome, so the conservative summary is faithful.",
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await adjudicateChunkReview({
    chunkSource: "The public meeting addressed a proposed zoning amendment for a semi-detached dwelling.",
    chunkSummary: "The body reviewed the proposed amendment; no final outcome is stated in this source.",
    bodyLabel: "Council Meeting - Regular",
    priorReview: "FINAL_SCORE: 0.50\nFEEDBACK: The heading proves the amendment was approved.",
  });

  assert.equal(result.score, 0.92);
  assert.equal(requestBody.model, "qwen3.5:9b");
  assert.match(requestBody.messages[1].content, /prior review is only a claim and may be wrong/iu);
  assert.match(requestBody.messages[1].content, /Do not infer approval.*agenda heading/iu);
});

test("whole-meeting coverage adjudication rechecks a disputed missing chunk", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 2
      ? { covered: false, evidence: "transit wording differs" }
      : { covered: true, evidence: calls === 1 ? "zoning topic present" : "transit continuation is identifiable" };
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await auditFinalChunkCoverage({
    chunks: [
      { "chunk id": "chunk_001", "chunk summary text": "The body reviewed a zoning proposal." },
      { "chunk id": "chunk_002", "chunk summary text": "The body received a transit continuation report." },
    ],
    summaryMd: "The recap covers the zoning proposal and continuation of regional transit.",
  });

  assert.equal(calls, 3);
  assert.deepEqual(result.missing, []);
  assert.match(result.adjudication, /transit continuation is identifiable/u);
});

test("whole-meeting review adjudication resolves conflicting claims from literal chunks", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: "FINAL_SCORE: 0.88\nFEEDBACK: The recap keeps the zoning proposal and transit discussion separate and states only outcomes supplied by the chunks.",
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await adjudicateFinalReviews({
    chunkSource: [
      "chunk_001 Summary: The body reviewed a proposed zoning amendment; no final outcome was recorded.",
      "chunk_002 Summary: The body received a transit continuation report.",
    ].join("\n"),
    summaryMd: "The body reviewed a zoning proposal and separately received a transit report.",
    bodyLabel: "Council Meeting - Regular",
    jurisdiction: "Owen Sound",
    reviews: [
      "FINAL_SCORE: 0.50\nFEEDBACK: The zoning heading proves approval.",
      "FINAL_SCORE: 0.85\nFEEDBACK: The topics are faithfully separated.",
      "FINAL_SCORE: 0.55\nFEEDBACK: Transit funding was misstated.",
    ],
  });

  assert.equal(result.score, 0.88);
  assert.equal(requestBody.model, "qwen3.5:9b");
  assert.match(requestBody.messages[1].content, /supplied reviews are untrusted claims/iu);
  assert.match(requestBody.messages[1].content, /Do not infer approval.*headings/iu);
});

test("whole-meeting numeric grounding includes ranked source details exposed to synthesis", () => {
  const source = buildFinalNumericGroundingSource(
    "Summary: Council discussed transit app improvements.",
    [{
      index: 5,
      heading: "Transit App Capital Project",
      summary: "Council approved $22,500 in the 2024 budget for GTFS data development.",
    }],
    ["July 23, 2026", "2026-07-23"],
  );
  assert.deepEqual(
    unsupportedNumericTokens(
      "On July 23, 2026, Council discussed the $22,500 approved in the 2024 budget.",
      source,
    ),
    [],
  );
});

test("meeting-wide one-sentence generation retries the complete teaser contract", () => {
  const source = fs.readFileSync(
    new URL("../world/house/owen-sound-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
    "utf8",
  );
  const generator = source.slice(
    source.indexOf("async function generateMeetingWideOneSentenceLlm"),
    source.indexOf("function oneSentenceMatchesLeadTopic"),
  );
  assert.match(generator, /explainMalformedOneSentence\(candidate/u);
  assert.match(generator, /at most 2 commas/u);
  assert.match(generator, /Math\.min\(3, blocks\.length\)/u);
  assert.match(generator, /all substantive recap items available for this short meeting/u);
  assert.match(generator, /Previous response contained \$\{lastWordCount\} words/u);
  assert.match(generator, /Return exactly 48-64 words/u);
  assert.match(generator, /Remove at least \$\{Math\.max\(1, lastWordCount - 64\)\} words/u);
  assert.match(generator, /maxWords: MEETING_TEASER_MAX_WORDS/u);
  assert.match(source, /const MEETING_TEASER_MAX_WORDS = 72/u);
  assert.match(source, /oneSentenceValidationContext = \{[\s\S]*?maxWords: MEETING_TEASER_MAX_WORDS/u);
});

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
  let chunkReviewCalls = 0;
  let finalDraftCalls = 0;
  let finalScoreCalls = 0;
  let coverageCalls = 0;

  global.fetch = async (_url, req) => {
    const body = JSON.parse(String(req?.body || "{}"));
    const prompt = String(body?.messages?.[1]?.content || "");
    let content = "";
    if (prompt.includes("Create a grounded, readable local-news chunk summary for whole-meeting synthesis.")) {
      chunkCalls += 1;
      content = `Chunk summary ${chunkCalls}: major topic, outcomes, follow-up, notable event.`;
    } else if (prompt.includes("Score CHUNK_SUMMARY for strict semantic faithfulness to CHUNK_SOURCE.")) {
      chunkReviewCalls += 1;
      content = "FINAL_SCORE: 0.95\nFEEDBACK: Faithful bounded summary.";
    } else if (prompt.includes("Create a readable, grounded whole-meeting local-news recap from chunk summaries.")) {
      finalDraftCalls += 1;
      content = [
        "# Whole Meeting Summary",
        finalDraftCalls < 3
          ? "Council approved the agenda before reviewing the substantive items."
          : "Opening summary sentence with context.",
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
    } else if (prompt.includes("Decide semantic topic coverage for one chronology chunk.")) {
      coverageCalls += 1;
      content = JSON.stringify({ covered: true, evidence: "covered" });
    } else if (prompt.includes("Score WHOLE_MEETING_SUMMARY for semantic faithfulness to CHUNK_SUMMARIES.")) {
      finalScoreCalls += 1;
      content = "FINAL_SCORE: 0.95\nFEEDBACK: Looks faithful.";
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
    assert.equal(chunkReviewCalls, out.chunkCount);
    assert.equal(finalDraftCalls, 3);
    assert.equal(finalScoreCalls >= 1, true);
    assert.equal(coverageCalls, finalDraftCalls * out.chunkCount);

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
