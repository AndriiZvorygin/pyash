import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_TEXT_MODEL } from "../program/runtime/gpu/text-model.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  adjudicateChunkReview,
  adjudicateFinalReviews,
  auditFinalChunkCoverage,
  buildFinalAgendaCoveragePlan,
  buildFinalAgendaCoverageBulletBank,
  buildFinalAgendaCoverageBulletGroups,
  buildFinalSummaryFrame,
  buildChronologyCoverageBulletGroups,
  repairMissingAgendaTopicBullets,
  buildChunkRetryGuidance,
  estimateWholeMeetingSummaryBudget,
  formatAgendaCoveragePlan,
  formatStructuredWholeMeetingSummary,
  buildFinalNumericGroundingSource,
  governingBodyDefects,
  namedCouncilActorDefects,
  previewTemporalDefects,
  rewriteChunkWithoutForbiddenActors,
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
  assert.deepEqual(
    previewTemporalDefects("The Committee - Community Services approved the recommendation."),
    ["Committee - Community Services approved"],
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

test("whole-meeting validation preserves explicitly sourced subordinate actions", () => {
  const source = "Section 12.b Summary: The Operations Committee approved the recommendation before Council received its minutes.";
  assert.deepEqual(
    governingBodyDefects(
      "The Operations Committee approved the recommendation.",
      "Council Meeting - Regular",
      source,
    ),
    [],
  );
  assert.deepEqual(
    governingBodyDefects(
      "The Operations Committee approved the recommendation.",
      "Council Meeting - Regular",
    ),
    ["Committee approved"],
  );
  assert.deepEqual(
    governingBodyDefects(
      "Committee approved the minutes.",
      "Council Meeting - Regular",
      "The Corporate Services Committee called the question in favor of approving the minutes, and the motion was carried.",
    ),
    [],
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
  assert.match(guidance, /absolute output blocklist/iu);
  assert.match(guidance, /write a fresh summary from the grounded source/iu);
  assert.doesNotMatch(guidance, /Revise the rejected draft below/iu);
  assert.doesNotMatch(guidance, /REJECTED_DRAFT:/u);
  assert.match(guidance, /Councillor Morgan/u);
});

test("actor rewrite uses a separate LLM-only blocklist pass", async (t) => {
  const originalFetch = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).messages[1].content;
    return { ok: true, async json() { return { message: { content: "- 1 CALL TO ORDER: The chair opened the meeting." } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const rewritten = await rewriteChunkWithoutForbiddenActors({
    candidate: "- 1 CALL TO ORDER: Chair Dave opened the meeting.",
    forbiddenNames: ["Chair Dave"],
    coveredHeadings: ["1 CALL TO ORDER"],
    bodyLabel: "River District Board of Management",
  });
  assert.equal(rewritten, "- 1 CALL TO ORDER: The chair opened the meeting.");
  assert.match(prompt, /ABSOLUTE OUTPUT BLOCKLIST: Chair Dave/u);
  assert.match(prompt, /Do not use any personal names/u);
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
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
  assert.match(requestBody.messages[1].content, /prior review is only a claim and may be wrong/iu);
  assert.match(requestBody.messages[1].content, /Do not infer approval.*agenda heading/iu);
});

test("whole-meeting chunk coverage retries when adjudication disputes a missing-topic finding", async (t) => {
  let calls = 0;
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    prompts.push(JSON.parse(options.body).messages[1].content);
    const content = calls === 2
      ? { has_substantive_topic: true, covered: false, evidence: "transit wording differs" }
      : { has_substantive_topic: true, covered: true, evidence: calls === 1 ? "zoning topic present" : "transit continuation is identifiable" };
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
  assert.deepEqual(result.missing, ["chunk_002: transit wording differs"]);
  assert.match(result.adjudication, /transit continuation is identifiable/u);
  assert.match(prompts[0], /at least one identifiable substantive topic from this chunk/iu);
});

test("whole-meeting chunk coverage exempts only semantically empty procedural chunks", async (t) => {
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[1].content;
    prompts.push(prompt);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              has_substantive_topic: false,
              covered: false,
              evidence: "This chunk contains only routine procedure and a transition, with no substantive topic to cover.",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await auditFinalChunkCoverage({
    chunks: [{
      "chunk id": "chunk_001",
      "chunk summary text": "The chair called the meeting to order, completed roll call, and moved into the next agenda section.",
    }],
    summaryMd: "The recap begins with substantive discussion later in the meeting.",
  });

  assert.deepEqual(result.missing, []);
  assert.match(prompts[0], /First classify whether SOURCE_SUMMARY contains any substantive reportable development/iu);
  assert.match(prompts[0], /Return strict JSON with all fields/iu);
  assert.match(prompts[0], /has_substantive_topic=false, do not require FINAL_SUMMARY to mention the chunk/iu);
});

test("whole-meeting agenda coverage checks distinct topics independently", async (t) => {
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[1].content;
    prompts.push(prompt);
    const content = prompt.includes("Extract a whole-meeting coverage checklist")
      ? { topics: [{ topic: "Rotary Pavilion fundraiser announcement", source_detail: "The Rotary Pavilion fundraiser announcement will support hospital equipment." }] }
      : { covered: false, evidence: "fundraiser announcement is omitted" };
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await auditFinalChunkCoverage({
    priorityItems: [{
      index: 8,
      heading: "News and Celebrations",
      summary: "The organization was recognized for its anniversary. A speaker separately announced a Rotary Pavilion fundraiser.",
    }],
    summaryMd: "The organization was recognized for its anniversary.",
  });

  assert.equal(prompts.length, 2);
  assert.deepEqual(result.missing, ["agenda section 8: News and Celebrations: Rotary Pavilion fundraiser announcement: fundraiser announcement is omitted"]);
  assert.match(prompts[0], /separate speaker contributions and event announcements distinct/iu);
  assert.match(prompts[1], /Check whether FINAL_SUMMARY includes this one source-grounded agenda topic/iu);
  assert.match(prompts[1], /ignore every other topic/iu);
  assert.match(prompts[1], /SOURCE_TOPIC: Rotary Pavilion fundraiser announcement/iu);
  assert.match(prompts[1], /SOURCE_TOPIC_DETAIL: The Rotary Pavilion fundraiser announcement will support hospital equipment/iu);
});

test("whole-meeting agenda coverage plan is reused and summary budget scales with required topics", async (t) => {
  const topics = Array.from({ length: 30 }, (_, index) => ({
    topic: `Source-grounded agenda development ${index + 1}`,
    source_detail: `The source records development ${index + 1}.`,
  }));
  const agendaCoveragePlan = [{
    "source id": "agenda section 8: News and Celebrations",
    topics,
  }];
  const budget = estimateWholeMeetingSummaryBudget({
    chunks: Array.from({ length: 19 }, () => ({})),
    agendaCoveragePlan,
  });
  assert.equal(budget.topicCount, 30);
  assert.equal(budget.wordBudget, 1912);
  assert.equal(budget.numPredict, 3824);
  const formatted = formatAgendaCoveragePlan(agendaCoveragePlan);
  assert.match(formatted, /1\. Source-grounded agenda development 1\n   Source detail: The source records development 1\./u);
  assert.match(formatted, /30\. Source-grounded agenda development 30\n   Source detail: The source records development 30\./u);

  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body).messages[1].content);
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ has_substantive_topic: true, covered: true, evidence: "topic is identifiable" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await auditFinalChunkCoverage({
    priorityItems: [{
      index: 8,
      heading: "News and Celebrations",
      summary: "Thirty separately reportable source-grounded developments.",
    }],
    agendaCoveragePlan: [{
      "source id": "agenda section 8: News and Celebrations",
      topics: [
        { topic: "The anniversary recognition", source_detail: "An anniversary recognition is listed." },
        { topic: "The separate fundraiser announcement", source_detail: "A separate fundraiser announcement is listed." },
      ],
    }],
    summaryMd: "The recap includes the recognition and separate announcement.",
  });
  assert.deepEqual(result.missing, []);
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every((prompt) => prompt.includes("Check whether FINAL_SUMMARY includes this one source-grounded agenda topic.")));
  assert.doesNotMatch(prompts.join("\n"), /Extract a whole-meeting coverage checklist/u);
});

test("whole-meeting agenda coverage topics retain source detail and reject incomplete plans", async () => {
  const prompts = [];
  const priorityItems = [{ index: 10, heading: "Public Works Report", summary: "The report recommends replacing the water treatment filters." }];
  await assert.rejects(buildFinalAgendaCoveragePlan({
    priorityItems,
    ask: async (messages) => {
      prompts.push(messages[1].content);
      return JSON.stringify({ topics: [{ topic: "Filter replacement recommendation" }] });
    },
  }), /topic without source detail/iu);
  assert.match(prompts[0], /"topic"[\s\S]*"source_detail"/iu);
  assert.match(prompts[0], /Preserve names, figures, and decision status exactly/iu);
});

test("whole-meeting agenda bullet bank retries missing topic rows and preserves model prose", async () => {
  const prompts = [];
  let calls = 0;
  const bank = await buildFinalAgendaCoverageBulletBank({
    agendaCoveragePlan: [{
      "source id": "agenda section 8: News and Celebrations",
      "source summary": "Two separate source-grounded developments were recorded.",
      topics: [
        { topic: "Anniversary recognition", source_detail: "The organization received recognition for its anniversary." },
        { topic: "Fundraiser announcement", source_detail: "A speaker announced a fundraiser for hospital equipment." },
      ],
    }],
    ask: async (messages) => {
      const prompt = messages[1].content;
      prompts.push(prompt);
      calls += 1;
      return calls === 1
        ? JSON.stringify({ topic_bullets: [{ topic_number: 1, bullet: "The organization was recognized for its anniversary." }] })
        : JSON.stringify({ topic_bullets: [
          { topic_number: 1, bullet: "The organization was recognized for its anniversary." },
          { topic_number: 2, bullet: "A speaker announced a fundraiser for hospital equipment." },
        ] });
    },
  });

  assert.equal(calls, 2);
  assert.match(prompts[1], /Missing or invalid topic numbers: 2/u);
  assert.match(bank, /- The organization was recognized for its anniversary\./u);
  assert.match(bank, /- A speaker announced a fundraiser for hospital equipment\./u);
  assert.doesNotMatch(bank, /Anniversary recognition|Fundraiser announcement/u);
});

test("segmented whole-meeting output adds LLM summaries for uncovered substantive chronology chunks", async () => {
  const prompts = [];
  const groups = await buildChronologyCoverageBulletGroups({
    chunks: [
      { "chunk id": "chunk_001", "covered headings": ["8 Public Forum"], "chunk summary text": "A resident raised a separate concern about the waterfront path." },
      { "chunk id": "chunk_002", "covered headings": ["9 Adjournment"], "chunk summary text": "The meeting adjourned." },
    ],
    chronologyRows: [
      { "source id": "chunk_001", has_substantive_topic: true, covered: false, evidence: "waterfront path concern omitted" },
      { "source id": "chunk_002", has_substantive_topic: false, covered: true, evidence: "procedure only" },
    ],
    agendaBullets: "- The agenda lists a separate shoreline report.",
    ask: async (messages) => {
      prompts.push(messages[1].content);
      return JSON.stringify({ topic_bullets: ["A resident separately raised a concern about the waterfront path."] });
    },
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0]["source id"], "chunk_001");
  assert.deepEqual(groups[0].bullets, ["A resident separately raised a concern about the waterfront path."]);
  assert.match(prompts[0], /AGENDA_BULLETS_ALREADY_INCLUDED:[\s\S]*shoreline report/u);
  assert.match(prompts[0], /AUDIT_FINDING_TO_CORRECT: waterfront path concern omitted/u);
  assert.match(prompts[0], /Include every independent substantive development/iu);
  const markdown = formatStructuredWholeMeetingSummary({
    frame: {
      opening_paragraph: "The preview contains a shoreline report and a separate public concern.",
      why_it_matters: ["The report addresses shoreline conditions.", "The public concern identifies a separate matter."],
      watch_next: ["No explicit follow-up was recorded."],
    },
    agendaBullets: ["The agenda lists a separate shoreline report."],
    chronologyBullets: groups.flatMap((group) => group.bullets),
  });
  assert.match(markdown, /shoreline report[\s\S]*waterfront path/iu);
  assert.equal((markdown.match(/^## /gmu) || []).length, 3);
});

test("whole-meeting editorial frame accepts heading-keyed LLM JSON without weakening required sections", async () => {
  let calls = 0;
  const frame = await buildFinalSummaryFrame({
    chunkSource: "Source-grounded chunk summary.",
    agendaCoveragePlan: [],
    coverageBulletBank: "- Generated source-grounded agenda bullet.",
    bodyLabel: "Council Meeting - Regular",
    jurisdiction: "Owen Sound",
    ask: async () => {
      calls += 1;
      return JSON.stringify({
        "opening_paragraph": "The preview covers a local report and related agenda decisions.",
        "Why It Matters": [
          "The report addresses a direct local service need.",
          "The listed decision affects municipal administration.",
        ],
        "Watch Next": "No explicit follow-up was recorded.",
      });
    },
  });

  assert.equal(calls, 1);
  assert.equal(frame.why_it_matters.length, 2);
  assert.deepEqual(frame.watch_next, ["No explicit follow-up was recorded."]);
});

test("agenda bullet generation retries an incomplete section as isolated LLM topic calls", async () => {
  const prompts = [];
  let sectionCalls = 0;
  const groups = await buildFinalAgendaCoverageBulletGroups({
    agendaCoveragePlan: [{
      "source id": "agenda section 11.n: Board minutes",
      "source summary": "The minutes record director elections and appointments of an auditor and solicitor.",
      topics: [
        { topic: "Director elections", source_detail: "The prior minutes record the director elections." },
        { topic: "Auditor and solicitor appointments", source_detail: "The prior minutes record both appointments." },
      ],
    }],
    ask: async (messages) => {
      const prompt = messages[1].content;
      prompts.push(prompt);
      if (prompt.includes("Create source-grounded recap bullets for every numbered topic")) {
        sectionCalls += 1;
        return JSON.stringify({ topic_bullets: [{ topic_number: 1, bullet: "The prior minutes record director elections." }] });
      }
      return JSON.stringify({ bullet: `The prior minutes record topic ${prompt.match(/TOPIC_NUMBER: (\d+)/u)?.[1]}.` });
    },
  });

  assert.equal(sectionCalls, 3);
  assert.equal(prompts.filter((prompt) => prompt.includes("Write one concise source-grounded recap bullet for this numbered agenda topic.")).length, 2);
  assert.equal(groups[0].bullets.length, 2);
  assert.match(groups[0].bullets[1].bullet, /topic 2/u);
});

test("coverage audit findings trigger an LLM rewrite of only the missing agenda topic", async () => {
  let prompt = "";
  const plan = [{
    "source id": "agenda section 11.n: Board minutes",
    "source summary": "The minutes record the appointment of an auditor and solicitor.",
    topics: [{ topic: "Auditor and solicitor appointments", source_detail: "The minutes record both 2027 fiscal-year appointments." }],
  }];
  const groups = [{
    "source id": plan[0]["source id"],
    bullets: [{ topic: plan[0].topics[0].topic, source_detail: plan[0].topics[0].source_detail, bullet: "The minutes concern the board's annual business." }],
  }];
  const repaired = await repairMissingAgendaTopicBullets({
    groups,
    agendaCoveragePlan: plan,
    missing: [`${plan[0]["source id"]}: Auditor and solicitor appointments: appointments are omitted`],
    ask: async (messages) => {
      prompt = messages[1].content;
      return JSON.stringify({ bullet: "The minutes record appointments of an auditor and solicitor for the 2027 fiscal year." });
    },
  });

  assert.match(prompt, /SOURCE_TOPIC: Auditor and solicitor appointments/u);
  assert.match(prompt, /appointments are omitted/u);
  assert.match(repaired[0].bullets[0].bullet, /auditor and solicitor for the 2027 fiscal year/u);
  assert.match(groups[0].bullets[0].bullet, /annual business/u, "repair does not mutate the caller's original group");
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
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
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

test("whole-meeting financial repairs preserve recap tense outside upcoming mode", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/whole-meeting-synthesis.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /SUMMARY_TIME_MODE === "upcoming"\n\s*\? "FINAL REMINDER: the meeting has not happened/iu);
  assert.match(source, /this is a recap of the completed meeting\. Preserve source-supported action and decision status/iu);
  assert.doesNotMatch(source, /`REJECTION_REASON:[\s\S]{0,500}FINAL REMINDER: the meeting has not happened\. Use scheduled/u);
});

test("whole-meeting chunk repair keeps separate events and speaker turns distinct", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "whole-meeting-topic-boundary-"));
  const meetingDir = path.join(tmpRoot, "2026-04-21_test-meeting_abc123");
  const transcriptDir = path.join(meetingDir, "transcript");
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(meetingDir, "meeting.json"),
    JSON.stringify({ payload: { meeting_name: "Committee - Community Services", jurisdiction: "Owen Sound" } }),
    "utf8",
  );
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
      sections: [{
        index: 1,
        "unit id": "unit_001",
        "parent unit id": "",
        "part index": 0,
        "part total": 1,
        heading: "News and Celebrations",
        summary: "During the public forum, the chair introduced Gray Agricultural Services to mark its twenty-fifth anniversary. Later, in a separate speaker turn, an organizer announced the annual Harbor 5K at Rotary Pavilion, which raises funds for hospital equipment.",
        "chapter text": "The anniversary recognition and the later fundraiser announcement were separate presentations.",
        score: 0.95,
        mode: "llm-stage3",
        "source rows": 10,
        "start row": 0,
        "end row": 9,
        "max section seconds": 900,
        "grounding status": "grounded",
      }],
    },
  );

  const oldFetch = global.fetch;
  let chunkDraftCalls = 0;
  let chunkReviewCalls = 0;
  let chunkAdjudicationCalls = 0;
  let finalDraftCalls = 0;
  let coverageCalls = 0;
  let finalReviewCalls = 0;
  const prompts = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(String(req?.body || "{}"));
    const prompt = String(body?.messages?.[1]?.content || "");
    prompts.push(prompt);
    let content = "";
    if (prompt.includes("Create a grounded, readable local-news chunk summary for whole-meeting synthesis.")) {
      chunkDraftCalls += 1;
      content = chunkDraftCalls === 1
        ? "- News and Celebrations: Gray Agricultural Services marked its twenty-fifth anniversary with its annual Harbor 5K at Rotary Pavilion, raising funds for hospital equipment."
        : "- News and Celebrations: Gray Agricultural Services was recognized for its twenty-fifth anniversary. In a separate announcement, an organizer described the annual Harbor 5K at Rotary Pavilion as a fundraiser for hospital equipment.";
    } else if (prompt.includes("Score CHUNK_SUMMARY for strict semantic faithfulness to CHUNK_SOURCE.")) {
      chunkReviewCalls += 1;
      content = chunkReviewCalls === 1
        ? "FINAL_SCORE: 0.42\nFEEDBACK: The summary incorrectly attaches the later fundraiser to the anniversary organization."
        : "FINAL_SCORE: 0.95\nFEEDBACK: The event and recognition remain separate, as in the source.";
    } else if (prompt.includes("Adjudicate a prior semantic review of CHUNK_SUMMARY against CHUNK_SOURCE.")) {
      chunkAdjudicationCalls += 1;
      content = "FINAL_SCORE: 0.42\nFEEDBACK: The source describes the anniversary recognition and later event as separate turns.";
    } else if (prompt.includes("Write only the short editorial frame for a complete civic meeting recap")) {
      content = JSON.stringify({
        opening_paragraph: "The preview includes a local anniversary recognition and a separate community fundraiser announcement.",
        why_it_matters: ["The recognition marks a local organization's milestone.", "The fundraiser announcement identifies hospital equipment as its purpose."],
        watch_next: ["No explicit unresolved follow-up was recorded."],
      });
    } else if (prompt.includes("Create a readable, grounded whole-meeting local-news recap from chunk summaries.")) {
      finalDraftCalls += 1;
      content = [
        "# Whole Meeting Summary",
        "The public forum included an anniversary recognition and a separate event announcement.",
        "",
        "## Top Newsworthy Developments",
        "- News and Celebrations: Gray Agricultural Services was recognized for its twenty-fifth anniversary.",
        ...(finalDraftCalls === 1 ? [] : [
          "- News and Celebrations: In a separate announcement, an organizer described the annual Harbor 5K at Rotary Pavilion as a fundraiser for hospital equipment.",
        ]),
        "",
        "## Why It Matters",
        finalDraftCalls === 1
          ? "The anniversary recognition marked a local organization's milestone."
          : "The annual fundraiser was announced as raising funds for hospital equipment.",
        "",
        "## Watch Next",
        "No explicit follow-up was recorded.",
      ].join("\n");
    } else if (prompt.includes("Decide semantic topic coverage for one chronology chunk.")) {
      coverageCalls += 1;
      content = JSON.stringify({ has_substantive_topic: true, covered: true, evidence: "substantive public forum topic" });
    } else if (prompt.includes("Extract a whole-meeting coverage checklist from this one civic agenda section.")) {
      coverageCalls += 1;
      content = JSON.stringify({ topics: [
        { topic: "Gray Agricultural Services anniversary recognition", source_detail: "The organization received anniversary recognition." },
        { topic: "Harbor 5K at Rotary Pavilion fundraiser announcement", source_detail: "The Harbor 5K was announced as a fundraiser at Rotary Pavilion." },
      ] });
    } else if (prompt.includes("Create source-grounded recap bullets for every numbered topic in this one agenda section.")) {
      content = JSON.stringify({ topic_bullets: [
        { topic_number: 1, bullet: "Gray Agricultural Services was recognized for its anniversary." },
        { topic_number: 2, bullet: "An organizer announced the Harbor 5K fundraiser at Rotary Pavilion." },
      ] });
    } else if (prompt.includes("Check whether FINAL_SUMMARY includes this one source-grounded agenda topic.")) {
      coverageCalls += 1;
      const missingEvent = finalDraftCalls === 1 && prompt.includes("SOURCE_TOPIC: Harbor 5K");
      content = JSON.stringify({
        covered: !missingEvent,
        evidence: missingEvent ? "Harbor 5K announcement is omitted" : "topic appears in the recap",
      });
    } else if (prompt.includes("Score WHOLE_MEETING_SUMMARY for semantic faithfulness to CHUNK_SUMMARIES.")) {
      finalReviewCalls += 1;
      content = "FINAL_SCORE: 0.95\nFEEDBACK: The summary preserves the separate recognition and event announcement.";
    } else {
      throw new Error(`unexpected prompt: ${prompt.slice(0, 100)}`);
    }
    return { ok: true, json: async () => ({ message: { content } }) };
  };
  t.after(() => {
    global.fetch = oldFetch;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const out = await summarizeWholeMeetingArtifacts({
    transcriptDirArg: transcriptDir,
    prefixArg: "meeting-qwen-auto-normalized",
    focusArg: "newsworthy bits",
    log: () => {},
  });
  const chunks = await readPyaMapArtifact(out.outChunksPya, "meeting summary chunks artifact");
  const finalSummary = await readPyaMapArtifact(out.outSummaryPya, "meeting summary artifact");
  const chunkText = chunks.chunks[0]["chunk summary text"];
  assert.equal(chunkDraftCalls, 2);
  assert.equal(chunkReviewCalls, 2);
  assert.equal(chunkAdjudicationCalls, 1);
  assert.equal(finalDraftCalls, 0);
  assert.equal(coverageCalls, 4);
  assert.equal(finalReviewCalls, 3);
  assert.match(chunkText, /anniversary[^.]*\.[\s\S]*separate announcement/iu);
  assert.doesNotMatch(chunkText, /anniversary with its annual Harbor 5K/iu);
  assert.match(finalSummary.markdown, /Gray Agricultural Services[^\n]*anniversary[\s\S]*Harbor 5K/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Create a grounded, readable local-news chunk summary")), /chronology or proximity alone does not establish a relationship/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Score CHUNK_SUMMARY for strict semantic faithfulness")), /without an explicit source relationship/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Create source-grounded recap bullets for every numbered topic")), /one non-empty bullet for each numbered topic/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Write only the short editorial frame")), /NUMBERED_AGENDA_TOPICS_WITH_SOURCE_DETAILS/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Score WHOLE_MEETING_SUMMARY for semantic faithfulness")), /even when they appear in the same supplied chunk/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Score WHOLE_MEETING_SUMMARY for semantic faithfulness")), /AGENDA_COVERAGE_CHECKLIST_WITH_SOURCE_DETAILS:[\s\S]*The organization received anniversary recognition/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Decide semantic topic coverage for one chronology chunk.")), /at least one substantive topic from this chunk must be identifiable in FINAL_SUMMARY; covered must be true/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Extract a whole-meeting coverage checklist")), /separate speaker contributions and event announcements distinct/iu);
  assert.match(prompts.find((prompt) => prompt.includes("Check whether FINAL_SUMMARY includes this one source-grounded agenda topic.")), /ignore every other topic/iu);
  assert.match(prompts.find((prompt) => prompt.includes("SOURCE_TOPIC: Harbor 5K")), /SOURCE_SUMMARY:.*Rotary Pavilion/isu);
});

test("whole-meeting quality repair receives rejected prose and semantic findings", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "whole-meeting-quality-repair-"));
  const meetingDir = path.join(tmpRoot, "2026-04-21_test-meeting_abc123");
  const transcriptDir = path.join(meetingDir, "transcript");
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(meetingDir, "meeting.json"),
    JSON.stringify({ payload: { meeting_name: "Committee of the Whole", jurisdiction: "Grey County" } }),
    "utf8",
  );

  const sections = [
    {
      index: 1,
      "unit id": "unit_001",
      "parent unit id": "",
      "part index": 0,
      "part total": 1,
      heading: "6.a Wetlands report and closed-session minutes",
      summary: "In closed session, a motion was moved to move the Committee's minutes, despite concerns. Separately, the Committee received a wetlands report. A member requested a recess for code-of-conduct training, but no approval of the request was recorded.",
      "chapter text": "Minutes, wetlands report, and a recess request",
      score: 0.95,
      mode: "llm-stage3",
      "source rows": 10,
      "start row": 0,
      "end row": 9,
      "max section seconds": 900,
      "grounding status": "grounded",
    },
    {
      index: 8,
      "unit id": "unit_008",
      "parent unit id": "",
      "part index": 0,
      "part total": 1,
      heading: "8 Other Business",
      summary: "Other business was addressed with no items presented.",
      "chapter text": "No other business items",
      score: 0.95,
      mode: "llm-stage3",
      "source rows": 1,
      "start row": 10,
      "end row": 10,
      "max section seconds": 900,
      "grounding status": "grounded",
    },
    {
      index: 9,
      "unit id": "unit_009",
      "parent unit id": "",
      "part index": 0,
      "part total": 1,
      heading: "9 Notice of Motion",
      summary: "A speaker asked whether there were any notices of motion to serve. Seeing no hands go up, the meeting moved to the next item.",
      "chapter text": "No notice of motion was served",
      score: 0.95,
      mode: "llm-stage3",
      "source rows": 1,
      "start row": 11,
      "end row": 11,
      "max section seconds": 900,
      "grounding status": "grounded",
    },
  ];
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

  const rejectedSummary = [
    "# Whole Meeting Summary",
    "The Committee officially adopted its minutes and linked wetlands funding to the code-of-conduct recess. The closed-session vote sparked dialogue.",
    "",
    "## Top Newsworthy Developments",
    "- The minutes were officially adopted.",
    "- Wetlands funding was linked to code-of-conduct training.",
    "",
    "## Why It Matters",
    "The vote sparked dialogue about the report.",
    "",
    "## Watch Next",
    "No explicit follow-up was recorded.",
  ].join("\n");
  const correctedSummary = [
    "# Whole Meeting Summary",
    "The Committee moved to adopt its minutes in closed session despite concerns. It separately received a wetlands report and heard a request for a code-of-conduct recess, with no approval of that request recorded.",
    "",
    "## Top Newsworthy Developments",
    "- A motion to move the Committee's minutes was recorded in closed session despite concerns.",
    "- The Committee separately received a wetlands report.",
    "- A member requested a code-of-conduct recess; no approval was recorded.",
    "",
    "## Why It Matters",
    "- The minutes motion and wetlands report had separate subjects and statuses.",
    "- The recess request remained a request.",
    "",
    "## Watch Next",
    "No explicit follow-up was recorded.",
  ].join("\n");
  const reviewerFinding = "The recap changes a motion to move the minutes into an adopted outcome and invents a wetlands funding link to the recess; the source records the request, not approval, and says the motion was made despite concerns.";

  const oldFetch = global.fetch;
  let finalDraftCalls = 0;
  let qualityRepairCalls = 0;
  let qualityRepairPrompt = "";
  let checklistPrompts = [];
  let summaryScoreCalls = 0;
  global.fetch = async (_url, req) => {
    const body = JSON.parse(String(req?.body || "{}"));
    const system = String(body?.messages?.[0]?.content || "");
    const prompt = String(body?.messages?.[1]?.content || "");
    let content;

    if (prompt.includes("Create a grounded, readable local-news chunk summary for whole-meeting synthesis.")) {
      content = "In closed session, a motion to move the minutes was recorded despite concerns. Separately, a wetlands report was received. A code-of-conduct recess was requested; no approval was recorded.";
    } else if (prompt.includes("Rewrite this already source-grounded chunk summary only to remove forbidden named council actors.")) {
      content = "In closed session, a motion to move the minutes was recorded despite concerns. Separately, a wetlands report was received. A code-of-conduct recess was requested; no approval was recorded.";
    } else if (prompt.includes("Score CHUNK_SUMMARY for strict semantic faithfulness to CHUNK_SOURCE.")) {
      content = "FINAL_SCORE: 0.95\nFEEDBACK: The source-supported actions and statuses remain distinct.";
    } else if (prompt.includes("Write only the short editorial frame for a complete civic meeting recap")) {
      content = JSON.stringify({
        opening_paragraph: "The agenda includes a minutes motion and a separate wetlands report.",
        why_it_matters: ["The minutes record the motion under consideration.", "The wetlands report remains a separate matter."],
        watch_next: ["No explicit unresolved follow-up was recorded."],
      });
    } else if (prompt.includes("Create a readable, grounded whole-meeting local-news recap from chunk summaries.")) {
      finalDraftCalls += 1;
      content = rejectedSummary;
    } else if (prompt.includes("Decide semantic topic coverage for one chronology chunk.")) {
      content = JSON.stringify({ has_substantive_topic: true, covered: true, evidence: "the minutes motion and distinct report topic are present" });
    } else if (prompt.includes("Extract a whole-meeting coverage checklist from this one civic agenda section.")) {
      checklistPrompts.push(prompt);
      content = JSON.stringify({ topics: [{ topic: "minutes motion and wetlands report", source_detail: "A motion to move the minutes was recorded, and a wetlands report was received." }] });
    } else if (prompt.includes("Create source-grounded recap bullets for every numbered topic in this one agenda section.")) {
      content = JSON.stringify({ topic_bullets: [{ topic_number: 1, bullet: "The minutes motion and wetlands report were recorded as separate actions." }] });
    } else if (prompt.includes("Check whether FINAL_SUMMARY includes this one source-grounded agenda topic.")) {
      content = JSON.stringify({ covered: true, evidence: "the substantive section is present" });
    } else if (/financial-claim verifier/iu.test(system)) {
      content = JSON.stringify({ verdict: "PASS", feedback: "No unsupported financial claim is retained." });
    } else if (prompt.includes("Score WHOLE_MEETING_SUMMARY for semantic faithfulness to CHUNK_SUMMARIES.")) {
      summaryScoreCalls += 1;
      content = qualityRepairCalls
        ? "FINAL_SCORE: 0.95\nFEEDBACK: The recap preserves the source's distinct actions, event order, and decision status."
        : `FINAL_SCORE: 0.50\nFEEDBACK: ${reviewerFinding}`;
    } else if (prompt.includes("Adjudicate conflicting semantic reviews of a whole-meeting civic recap.")) {
      content = `FINAL_SCORE: 0.50\nFEEDBACK: ${reviewerFinding}`;
    } else if (/Write a fresh, complete, source-grounded civic meeting summary/iu.test(system)) {
      qualityRepairCalls += 1;
      qualityRepairPrompt = prompt;
      content = correctedSummary;
    } else {
      throw new Error(`unexpected whole-meeting prompt: ${prompt.slice(0, 120)}`);
    }

    return { ok: true, json: async () => ({ message: { content } }) };
  };
  t.after(() => {
    global.fetch = oldFetch;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const out = await summarizeWholeMeetingArtifacts({
    transcriptDirArg: transcriptDir,
    prefixArg: "meeting-qwen-auto-normalized",
    focusArg: "newsworthy bits",
    log: () => {},
  });

  const summary = await readPyaMapArtifact(out.outSummaryPya, "meeting summary artifact");
  assert.equal(finalDraftCalls, 4, "the semantically rejected first-pass recap reaches bounded quality repair");
  assert.equal(qualityRepairCalls, 1);
  assert.match(qualityRepairPrompt, /PRIOR_REJECTED_RECAP:[\s\S]*The Committee officially adopted its minutes/iu);
  assert.match(qualityRepairPrompt, new RegExp(reviewerFinding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(qualityRepairPrompt, /LLM_GENERATED_AGENDA_COVERAGE_BULLET_BANK:[\s\S]*minutes motion and wetlands report/iu);
  assert.doesNotMatch(checklistPrompts.join("\n"), /agenda section (?:8: 8 Other Business|9: 9 Notice of Motion)/u);
  assert.match(summary.markdown, /moved to adopt its minutes.*despite concerns/iu);
  assert.match(summary.markdown, /separately received a wetlands report/iu);
  assert.doesNotMatch(summary.markdown, /officially adopted|funding to the code-of-conduct recess|vote sparked dialogue/iu);
  assert.equal(summaryScoreCalls, 18, "segmented synthesis, retry candidates, and the repair are reviewed against the output contract");
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

  const sectionHeadings = [
    "2 O Canada",
    "3 Roll Call",
    "4 Land Acknowledgement",
    "5 Declaration of Interest",
    "6.a County Council and Committee of the Whole minutes dated June 26, 2025",
    "10 News and Celebrations",
  ];
  const sections = Array.from({ length: 6 }, (_, i) => ({
    index: i + 1,
    "unit id": `unit_${String(i + 1).padStart(3, "0")}`,
    "parent unit id": "",
    "part index": 0,
    "part total": 1,
    heading: sectionHeadings[i],
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
  let topicCoverageChecks = 0;
  const prompts = [];

  global.fetch = async (_url, req) => {
    const body = JSON.parse(String(req?.body || "{}"));
    const prompt = String(body?.messages?.[1]?.content || "");
    prompts.push(prompt);
    let content = "";
    if (prompt.includes("Create a grounded, readable local-news chunk summary for whole-meeting synthesis.")) {
      chunkCalls += 1;
      content = `Chunk summary ${chunkCalls}: major topic, outcomes, follow-up, notable event.`;
    } else if (prompt.includes("Score CHUNK_SUMMARY for strict semantic faithfulness to CHUNK_SOURCE.")) {
      chunkReviewCalls += 1;
      content = "FINAL_SCORE: 0.95\nFEEDBACK: Faithful bounded summary.";
    } else if (prompt.includes("Write only the short editorial frame for a complete civic meeting recap")) {
      content = JSON.stringify({
        opening_paragraph: "The agenda presents local reports and decisions for the governing body's upcoming work.",
        why_it_matters: ["The listed matters affect local administration.", "The reports provide information for upcoming decisions."],
        watch_next: ["No explicit unresolved follow-up was recorded."],
      });
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
      content = JSON.stringify({ has_substantive_topic: true, covered: true, evidence: "covered" });
    } else if (prompt.includes("Extract a whole-meeting coverage checklist from this one civic agenda section.")) {
      coverageCalls += 1;
      content = JSON.stringify({ topics: [{ topic: "agenda source topic", source_detail: "The agenda section identifies this source topic." }] });
    } else if (prompt.includes("Create source-grounded recap bullets for every numbered topic in this one agenda section.")) {
      content = JSON.stringify({ topic_bullets: [{ topic_number: 1, bullet: "The agenda section identifies this source topic as a distinct matter for the governing body to consider, with supporting details in the item." }] });
    } else if (prompt.includes("Write one concise source-grounded recap bullet for this numbered agenda topic.")) {
      content = JSON.stringify({ bullet: "The agenda section identifies this source topic with the supporting details supplied under its item." });
    } else if (prompt.includes("Check whether FINAL_SUMMARY includes this one source-grounded agenda topic.")) {
      coverageCalls += 1;
      topicCoverageChecks += 1;
      content = JSON.stringify({ covered: topicCoverageChecks !== 1, evidence: topicCoverageChecks === 1 ? "the required source topic is omitted" : "covered" });
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
    assert.equal(finalDraftCalls, 0);
    assert.equal(finalScoreCalls >= 1, true);
    assert.equal(coverageCalls, (out.chunkCount * 2) + 6);
    const checklistPrompts = prompts.filter((prompt) => prompt.includes("Extract a whole-meeting coverage checklist"));
    const topicCoveragePrompts = prompts.filter((prompt) => prompt.includes("Check whether FINAL_SUMMARY includes this one source-grounded agenda topic."));
    assert.equal(checklistPrompts.length, 2);
    assert.equal(topicCoveragePrompts.length, 4);
    assert.match(checklistPrompts.join("\n"), /News and Celebrations/iu);
    assert.doesNotMatch(checklistPrompts.join("\n"), /O Canada|Roll Call|Land Acknowledgement|Declaration of Interest/iu);
    const finalPrompt = prompts.find((prompt) => prompt.includes("Write only the short editorial frame"));
    assert.match(finalPrompt, /NUMBERED_AGENDA_TOPICS_WITH_SOURCE_DETAILS:[\s\S]*agenda source topic/iu);
    assert.match(finalPrompt, /Source detail: The agenda section identifies this source topic/iu);
    assert.doesNotMatch(finalPrompt, /CHUNK_SUMMARIES|LLM_GENERATED_AGENDA_BULLETS/iu);
    const summary = await readPyaMapArtifact(out.outSummaryPya, "meeting summary artifact");
    assert.match(summary.markdown, /source topic with the supporting details supplied under its item/iu);
    const generatedTopicPrompt = prompts.find((prompt) => prompt.includes("Create source-grounded recap bullets for every numbered topic"));
    assert.match(generatedTopicPrompt, /Return exactly one non-empty bullet for each numbered topic/iu);

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
