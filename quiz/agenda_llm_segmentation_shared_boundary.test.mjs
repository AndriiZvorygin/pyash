import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  auditWholeChronologyCandidates,
  alignEvidenceToAtomicUnit,
  auditUnownedTranscriptPrefix,
  buildMeetingScopeEndPrompt,
  buildMeetingScopeStartPrompt,
  buildGroundedTimeline,
  callOllamaJson,
  competingCanonicalIdentityHasDirectSupport,
  dedupeCandidatesByAgendaItem,
  directlySupportedCompetingIdentity,
  locateCanonicalMeetingScopeEnd,
  locateCanonicalMeetingScopeStart,
  normalizeDisposition,
  pruneConflictingBoundaryCandidates,
  reconcileTimelineInBatches,
  refineFocusedRecoveryEarliest,
  resolveCandidateAgendaIdentity,
  resolveCanonicalHierarchyOwnership,
  resolveSharedBoundaryOwnership,
  splitOversizedTranscriptUnits,
  verifyCandidateSemantics,
  validateReconciledTimeline,
} from "../program/library/reporter_shared/agenda-llm-segmentation.mjs";

function scopeFixture() {
  const canonical = {
    items: [
      { item: "1", title: "Call to Order", level: 1, substantive: false },
      { item: "2", title: "Staff Report", level: 1, substantive: true },
    ],
  };
  const units = [
    { "atomic unit id": "atomic_000001", "source row": 0, since: 0, until: 5, speaker: "CHAIR", text: "County Council is now called to order." },
    { "atomic unit id": "atomic_000002", "source row": 1, since: 5, until: 10, speaker: "CHAIR", text: "County Council is adjourned." },
    { "atomic unit id": "atomic_000003", "source row": 2, since: 10, until: 15, speaker: "CHAIR", text: "I call this Committee of the Whole meeting to order." },
    { "atomic unit id": "atomic_000004", "source row": 3, since: 15, until: 20, speaker: "STAFF", text: "The staff report is before committee." },
  ];
  const dispositions = [
    { "agenda item": "1", status: "executed", "atomic unit id": "atomic_000003", role: "procedural", "evidence quote": "Committee of the Whole meeting", confidence: 0.95 },
    { "agenda item": "2", status: "executed", "atomic unit id": "atomic_000004", role: "staff_report", "evidence quote": "staff report is before committee", confidence: 0.95 },
  ];
  return { canonical, units, dispositions };
}

test("whole-chronology candidates require an independent blind boundary audit", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[1].content, /No proposed agenda identity is supplied|Choose from every canonical item supplied/u);
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          "agenda item": "NONE",
          "atomic unit id": "",
          "evidence quote": "",
          confidence: 0.98,
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const canonical = {
    items: [
      { item: "7.a", title: "Planning Committee minutes", level: 2, substantive: true },
      { item: "7.b", title: "Housing Action Plan", level: 2, substantive: true },
    ],
  };
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "STAFF", text: "The housing presentation began earlier." },
    { "atomic unit id": "atomic_000002", speaker: "STAFF", text: "Supportive and transitional housing projects continue." },
  ];
  const audited = await auditWholeChronologyCandidates({
    candidates: [{
      "agenda item": "7.a",
      "atomic unit id": "atomic_000002",
      "evidence quote": "Supportive and transitional housing projects continue.",
      role: "other",
      confidence: 0.95,
      "semantic verification": "qwen3.5:9b complete-chronology segmentation with literal evidence",
    }],
    canonical,
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    log: () => {},
  });
  assert.deepEqual(audited, []);
});

test("an independently verified explicit revisit survives agenda-item deduplication", async (t) => {
  let calls = 0;
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const prompt = JSON.parse(options.body).messages[1].content;
    prompts.push(prompt);
    if (calls === 1) return { ok: true, async json() { return { message: { content: JSON.stringify({ "agenda item": "7.a", "atomic unit id": "atomic_000001", "evidence quote": "Committee began the planning minutes.", confidence: 0.95 }) } }; } };
    if (calls === 2) return { ok: true, async json() { return { message: { content: JSON.stringify({ accepted: true, confidence: 0.95 }) } }; } };
    if (calls === 3) return { ok: true, async json() { return { message: { content: JSON.stringify({ "agenda item": "7.a", "atomic unit id": "atomic_000003", "evidence quote": "Committee returned to the planning minutes.", confidence: 0.95 }) } }; } };
    return { ok: true, async json() { return { message: { content: JSON.stringify({ accepted: true, confidence: 0.95 }) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const canonical = { items: [{ item: "7.a", title: "Planning Committee Minutes", level: 2, substantive: true }] };
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "CHAIR", text: "Committee began the planning minutes." },
    { "atomic unit id": "atomic_000002", speaker: "STAFF", text: "A separate housing report was heard." },
    { "atomic unit id": "atomic_000003", speaker: "CHAIR", text: "Committee returned to the planning minutes." },
  ];
  const candidates = [
    { "agenda item": "7.a", "atomic unit id": "atomic_000001", "evidence quote": units[0].text, role: "minutes", confidence: 0.95, "semantic verification": "qwen3.5:9b complete-chronology segmentation with literal evidence" },
    { "agenda item": "7.a", "atomic unit id": "atomic_000003", "evidence quote": units[2].text, role: "minutes", confidence: 0.95, "semantic verification": "qwen3.5:9b complete-chronology segmentation with literal evidence" },
  ];
  const audited = await auditWholeChronologyCandidates({ candidates, canonical, units, llmModel: "qwen3.5:9b", ollamaUrl: "http://ollama.invalid/api/chat" });
  const deduped = dedupeCandidatesByAgendaItem(audited, canonical);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[1]["explicit revisit"], true);
  assert.match(prompts[2], /possible explicit revisit/u);
  assert.match(prompts[2], /do not collapse it to the first occurrence/u);
});

test("focused recovery preserves a directly supported competing blind identity", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { message: { content: JSON.stringify({
        "agenda item": "8.a.1",
        "atomic unit id": "atomic_000001",
        "evidence quote": "Reports of city staff begin with traffic by-law amendments.",
        confidence: 0.95,
      }) } };
    },
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const canonical = { items: [
    { item: "8.a.1", title: "Traffic By-law Amendments", level: 3, substantive: true },
    { item: "8.c.1", title: "Flat Rate Water Charge", level: 3, substantive: true },
  ] };
  const units = [{
    "atomic unit id": "atomic_000001",
    speaker: "CHAIR",
    text: "Reports of city staff begin with traffic by-law amendments.",
  }];
  const proposed = [{
    "agenda item": "8.c.1",
    "atomic unit id": "atomic_000001",
    "evidence quote": units[0].text,
    role: "staff_report",
    confidence: 0.95,
  }];
  const competingSelections = [];
  const accepted = await verifyCandidateSemantics({
    proposed,
    canonical,
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    log: () => {},
    competingSelections,
  });
  assert.deepEqual(accepted, []);
  assert.equal(competingSelections.length, 1);
  assert.equal(competingSelections[0].classified["agenda item"], "8.a.1");
});

test("candidate identity canonicalizes spoken numeric agenda codes", () => {
  const canonical = { items: [
    { item: "11", title: "Correspondence", level: 1, substantive: false },
    { item: "8.c.1", title: "Sanitizer report", level: 3, substantive: true },
    { item: "11.a", title: "Bill 17 correspondence", level: 3, substantive: true },
    { item: "21.b", title: "Development update", level: 3, substantive: true },
  ] };
  assert.equal(resolveCandidateAgendaIdentity({ "agenda item": "Eleven A", "agenda item raw": "Eleven A" }, canonical)["agenda item"], "11.a");
  assert.equal(resolveCandidateAgendaIdentity({ "agenda item": "11.a — Bill 17 correspondence", "agenda item raw": "11.a — Bill 17 correspondence" }, canonical)["agenda item"], "11.a");
  assert.equal(resolveCandidateAgendaIdentity({ "agenda item": "8C1", "agenda item raw": "8C1" }, canonical)["agenda item"], "8.c.1");
  assert.equal(resolveCandidateAgendaIdentity({ "agenda item": "twenty one b", "agenda item raw": "twenty one b" }, canonical)["agenda item"], "21.b");
});

test("focused recovery does not move a substantive child onto a generic parent heading", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { message: { content: JSON.stringify({
        "agenda item": "Eleven A",
        "atomic unit id": "atomic_000001",
        "evidence quote": "We have a couple items of correspondence.",
        confidence: 0.95,
      }) } };
    },
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const canonical = { items: [{ item: "11.a", title: "Correspondence regarding Provincial Bill 17", level: 3, substantive: true }] };
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "CHAIR", text: "We have a couple items of correspondence." },
    { "atomic unit id": "atomic_000002", speaker: "CHAIR", text: "Eleven A is regarding Bill Seventeen and changes therein." },
  ];
  const accepted = await verifyCandidateSemantics({
    proposed: [{
      "agenda item": "11.a",
      "atomic unit id": "atomic_000002",
      role: "correspondence",
      "evidence quote": units[1].text,
      confidence: 0.95,
      "focused recovery candidate": true,
    }],
    canonical,
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.test/api/chat",
    log: () => {},
  });
  assert.deepEqual(accepted, []);
});

test("literal structured title evidence rejects a proposal-biased unrelated recovery", () => {
  const canonical = { items: [
    { item: "4.a", title: "Minutes of the Operations Committee meeting held on November 20, 2025", level: 2, substantive: true },
    { item: "8.c.1", title: "Flat Rate Water Charge and Water-related Fee Amendments", level: 3, substantive: true },
  ] };
  const competing = directlySupportedCompetingIdentity({
    target: canonical.items[0],
    canonical,
    transcriptSpan: "The Operations Committee recommends the flat rate water charge and water-related fee amendments.",
  });
  assert.equal(competing?.item, "8.c.1");
});

test("focused recovery retries a late interior boundary against the full preceding chronology", async (t) => {
  let calls = 0;
  const prompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    prompts.push(JSON.parse(options.body).messages[1].content);
    const atomic = calls === 1 ? "atomic_000004" : "atomic_2";
    const quote = calls === 1
      ? "The recommendation sets a monthly administration fee."
      : "One further report concerns the flat rate water charge.";
    return { ok: true, async json() { return { message: { content: JSON.stringify({
      "agenda item": "8.c.1", "atomic unit id": atomic, "evidence quote": quote, confidence: 0.95,
    }) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "CHAIR", text: "The transit motion carried." },
    { "atomic unit id": "atomic_000002", speaker: "CHAIR", text: "One further report concerns the flat rate water charge." },
    { "atomic unit id": "atomic_000003", speaker: "STAFF", text: "The water meter replacement project is ending." },
    { "atomic unit id": "atomic_000004", speaker: "STAFF", text: "The recommendation sets a monthly administration fee." },
  ];
  const result = await refineFocusedRecoveryEarliest({
    candidate: { "agenda item": "8.c.1", "atomic unit id": "atomic_000004", "evidence quote": units[3].text, role: "staff_report", confidence: 0.95 },
    entry: { item: "8.c.1", title: "Flat Rate Water Charge", level: 3, substantive: true },
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    boundaryVerifier: async () => true,
  });
  assert.equal(calls, 3);
  assert.equal(result["atomic unit id"], "atomic_000002");
  assert.match(prompts[1], /Exclude the recommendation wording/u);
});

test("earliest-start audit rejects an earlier boundary owned by a competing structured title", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    const output = calls === 1
      ? { "agenda item": "8.c.1", "atomic unit id": "atomic_000001", "evidence quote": "Traffic by-law amendments are the first staff report.", confidence: 0.95 }
      : { "agenda item": "8.c.1", "atomic unit id": "atomic_000002", "evidence quote": "One further report concerns the flat rate water charge.", confidence: 0.95 };
    return { ok: true, async json() { return { message: { content: JSON.stringify(output) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const entry = { item: "8.c.1", title: "Flat Rate Water Charge", level: 3, substantive: true };
  const canonical = { items: [
    { item: "8.a.1", title: "Traffic By-law Amendments", level: 3, substantive: true },
    entry,
  ] };
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "CHAIR", text: "Traffic by-law amendments are the first staff report." },
    { "atomic unit id": "atomic_000002", speaker: "CHAIR", text: "One further report concerns the flat rate water charge." },
    { "atomic unit id": "atomic_000003", speaker: "STAFF", text: "The recommendation sets the billing method." },
  ];
  const result = await refineFocusedRecoveryEarliest({
    candidate: { "agenda item": "8.c.1", "atomic unit id": "atomic_000003", "evidence quote": units[2].text, role: "staff_report", confidence: 0.95 },
    entry,
    canonical,
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    boundaryVerifier: async () => true,
  });
  assert.equal(calls, 3);
  assert.equal(result["atomic unit id"], "atomic_000002");
});

test("focused audit advances from a competing shared boundary to the adjacent target start", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { message: { content: JSON.stringify({
    "agenda item": "Minutes of the prior meeting",
    "atomic unit id": "atomic_000002",
    "evidence quote": "CHAIR: Confirmation of the minutes of the November meeting.",
    confidence: 0.95,
  }) } }; } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const entry = { item: "4.a", title: "Minutes of the Operations Committee meeting", level: 2, substantive: true };
  const canonical = { items: [
    { item: "3", title: "Declarations of Interest", level: 1, substantive: false },
    entry,
  ] };
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "CHAIR", text: "Declarations of interest are there any declarations?" },
    { "atomic unit id": "atomic_000002", speaker: "CHAIR", text: "Confirmation of the minutes of the November meeting." },
  ];
  const result = await refineFocusedRecoveryEarliest({
    candidate: { "agenda item": "4.a", "atomic unit id": "atomic_000001", "evidence quote": units[0].text, role: "minutes", confidence: 0.95 },
    entry,
    canonical,
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    boundaryVerifier: async () => true,
  });
  assert.equal(result["atomic unit id"], "atomic_000002");
  assert.equal(result["evidence quote"], units[1].text);
});

test("focused earliest-start audit keeps the verified boundary when an earlier literal fragment is semantically unrelated", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { message: { content: JSON.stringify({
    "agenda item": "6.d",
    "atomic unit id": "atomic_000001",
    "evidence quote": "The housing sector remains an important partner.",
    confidence: 0.95,
  }) } }; } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "STAFF", text: "The housing sector remains an important partner." },
    { "atomic unit id": "atomic_000002", speaker: "CHAIR", text: "Discussion on housing concluded." },
    { "atomic unit id": "atomic_000003", speaker: "CHAIR", text: "We return to the pulled minor exemption item." },
  ];
  const result = await refineFocusedRecoveryEarliest({
    candidate: { "agenda item": "6.d", "atomic unit id": "atomic_000003", "evidence quote": units[2].text, role: "staff_report", confidence: 0.95 },
    entry: { item: "6.d", title: "Minor Exemption", level: 2, substantive: true },
    canonical: { items: [{ item: "6.d", title: "Minor Exemption", level: 2, substantive: true }] },
    units,
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    boundaryVerifier: async ({ candidate }) => candidate["atomic unit id"] === "atomic_000003",
  });
  assert.equal(result["atomic unit id"], "atomic_000003");
});

test("chronology prompts keep consecutive sibling items separate for one presenter", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-llm-segmentation.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Consecutive canonical sibling items remain separate when the same presenter continues/u);
  assert.match(source, /explicit next item code, second part, next matter, or changed named subject/u);
  assert.match(source, /Qwen consecutive-sibling start refinement/u);
  assert.match(source, /focused recovery rejected after blind start refinement/u);
  assert.match(source, /focused recovery rejected shared boundary/u);
  assert.match(source, /focused recovery preserved direct competing identity/u);
  assert.match(source, /AGENDA_BOUNDARY_REFINEMENT_WORDS/u);
  assert.match(source, /move forward by at most 8 atomic units/u);
  assert.match(source, /"focused recovery refined": true/u);
  assert.match(source, /requiredChronologyHeading/u);
  assert.match(source, /public forum\|by-\?laws\?\|adjournment/u);
  assert.match(source, /requiredHeadingEvidenceIsLiteral/u);
});

test("a blind competing identity wins when the transcript directly announces its canonical title", () => {
  assert.equal(competingCanonicalIdentityHasDirectSupport({
    target: { item: "4.b", title: "Minutes of the Regular Council meeting held on July 13, 2026" },
    competing: { item: "8", title: "PUBLIC FORUM" },
    transcriptSpan: "Move to number eight on our agenda: public forum.",
  }), true);
  assert.equal(competingCanonicalIdentityHasDirectSupport({
    target: { item: "8", title: "PUBLIC FORUM" },
    competing: { item: "4.b", title: "Minutes of the Regular Council meeting held on July 13, 2026" },
    transcriptSpan: "Move to number eight on our agenda: public forum.",
  }), false);
});

test("grounded chronology leaves a preceding separate meeting unowned", () => {
  const { canonical, units, dispositions } = scopeFixture();
  const grounded = buildGroundedTimeline({ canonical, units, dispositions });
  assert.equal(grounded[0]["atomic start"], "atomic_000003");
  assert.doesNotMatch(grounded[0]["source excerpt"], /County Council/u);
});

test("unowned prefix requires Qwen scope evidence before it may be excluded", async () => {
  const fixture = scopeFixture();
  const accepted = await auditUnownedTranscriptPrefix({
    ...fixture,
    scopeAuditProvider: async () => ({
      out_of_scope: true,
      reason: "preceding County Council meeting",
      evidence_quote: "County Council is adjourned",
      confidence: 0.96,
    }),
  });
  assert.equal(accepted["prefix atomic units"], 2);
  assert.equal(accepted["out of scope"], true);

  await assert.rejects(
    auditUnownedTranscriptPrefix({
      ...fixture,
      scopeAuditProvider: async () => ({
        out_of_scope: false,
        reason: "could be opening remarks",
        evidence_quote: "County Council is adjourned",
        confidence: 0.96,
      }),
    }),
    /without validated separate-meeting evidence/u,
  );
});

test("named meeting scope excludes a preceding meeting using an LLM-grounded start", async () => {
  const { canonical, units } = scopeFixture();
  const scope = await locateCanonicalMeetingScopeStart({
    canonical,
    units,
    meetingLabel: "Committee of the Whole",
    scopeStartProvider: async () => ({
      found: true,
      "atomic unit id": "atomic_000003",
      "evidence quote": "Committee of the Whole meeting",
      reason: "named Committee meeting call to order",
      confidence: 0.97,
    }),
  });
  assert.equal(scope["scope atomic start"], "atomic_000003");
  assert.equal(scope["prefix atomic units"], 2);
  assert.equal(scope["out of scope"], true);
});

test("meeting scope rejects a different explicitly named live meeting with overlapping agenda vocabulary", async () => {
  const { canonical, units } = scopeFixture();
  let scopeCalls = 0;
  const rejected = [];
  const result = await locateCanonicalMeetingScopeStart({
    canonical,
    units,
    meetingLabel: "Committee of the Whole",
    scopeStartProvider: async () => {
      scopeCalls += 1;
      return scopeCalls === 1
        ? { found: true, "atomic unit id": "atomic_000001", "evidence quote": "County Council is now called to order", reason: "opening civic agenda", confidence: 0.95 }
        : { found: true, "atomic unit id": "atomic_000003", "evidence quote": "Committee of the Whole meeting to order", reason: "named target opening", confidence: 0.95 };
    },
    scopeStartIdentityProvider: async ({ atomicId }) => {
      if (atomicId === "atomic_000001") {
        rejected.push(atomicId);
        return { accepted: false, confidence: 0.99, reason: "County Council is a different named meeting" };
      }
      return { accepted: true, confidence: 0.99, reason: "target named directly" };
    },
  });
  assert.deepEqual(rejected, ["atomic_000001"]);
  assert.equal(result["scope atomic start"], "atomic_000003");
  assert.equal(result["prefix atomic units"], 2);
});

test("named meeting scope canonicalizes an LLM atomic id with omitted zero padding", async () => {
  const { canonical, units } = scopeFixture();
  const scope = await locateCanonicalMeetingScopeStart({
    canonical,
    units,
    meetingLabel: "Committee of the Whole",
    scopeStartProvider: async () => ({
      found: true,
      "atomic unit id": "atomic_003",
      "evidence quote": "Committee of the Whole meeting",
      reason: "named Committee meeting call to order",
      confidence: 0.97,
    }),
  });
  assert.equal(scope["scope atomic start"], "atomic_000003");
  assert.equal(scope["prefix atomic units"], 2);
  assert.equal(scope["out of scope"], true);
});

test("named meeting scope accepts literal call-to-order evidence spanning adjacent short atomic units", async () => {
  const canonical = {
    items: [
      { item: "1", title: "Call to Order", level: 1, substantive: false },
      { item: "2", title: "Declaration of Interest", level: 1, substantive: false },
    ],
  };
  const units = [
    { "atomic unit id": "atomic_000001", text: "Waiting for quorum." },
    { "atomic unit id": "atomic_000002", text: "Like to call this meeting" },
    { "atomic unit id": "atomic_000003", text: "to order at nine oh one." },
    { "atomic unit id": "atomic_000004", text: "Any declarations of interest?" },
  ];
  const scope = await locateCanonicalMeetingScopeStart({
    canonical,
    units,
    meetingLabel: "Agricultural Advisory Committee",
    scopeStartProvider: async () => ({
      found: true,
      "atomic unit id": "atomic_000002",
      "evidence quote": "Like to call this meeting to order at nine oh one",
      reason: "literal call to order begins the target canonical sequence",
      confidence: 0.97,
    }),
  });
  assert.equal(scope["scope atomic start"], "atomic_000002");
  assert.equal(scope["prefix atomic units"], 1);
});

test("meeting scope prompt recognizes an unnamed canonical opening before another meeting handoff", () => {
  const prompt = buildMeetingScopeStartPrompt({
    canonical: {
      items: [
        { item: "1", title: "Call to Order" },
        { item: "2", title: "Land Acknowledgement" },
        { item: "3", title: "Declarations of Interest" },
      ],
    },
    meetingLabel: "County Council",
    window: {
      "window id": "window_0001",
      text: [
        "[atomic_000001] Chair: I will bring the meeting to order.",
        "[atomic_000002] Chair: We give thanks to the traditional keepers of these lands.",
        "[atomic_000003] Chair: Are there any declarations of interest?",
        "[atomic_000004] Chair: We will now begin Committee of the Whole.",
      ].join("\n"),
    },
  });
  assert.match(prompt, /sequence of the target canonical opening items/u);
  assert.match(prompt, /later explicitly hands off to a different named meeting/u);
  assert.match(prompt, /multiple distinct canonical items/u);
});

test("meeting scope retry prompt explicitly adjudicates a direct unnamed opening", () => {
  const prompt = buildMeetingScopeStartPrompt({
    canonical: { items: [{ item: "1", title: "Call to Order" }, { item: "2", title: "Declaration of Interest" }] },
    meetingLabel: "Budget and Finance Committee",
    retryReason: "the first pass required the formal meeting name",
    window: { "window id": "window_0001", text: "[atomic_000001] Chair: Good morning. We will call the meeting to order.\n[atomic_000002] Chair: Any declaration of interest?" },
  });
  assert.match(prompt, /bounded retry with a different adjudication instruction/u);
  assert.match(prompt, /Do not require the formal meeting name to be spoken/u);
  assert.match(prompt, /quote the literal text from the proposed anchor unit/u);
});

test("named meeting scope retries an initially rejected unnamed canonical opening", async () => {
  const { canonical, units } = scopeFixture();
  let calls = 0;
  const scope = await locateCanonicalMeetingScopeStart({
    canonical,
    units: units.slice(2),
    meetingLabel: "Committee of the Whole",
    scopeStartProvider: async ({ retryReason }) => {
      calls += 1;
      if (calls === 1) {
        return {
          found: false,
          "atomic unit id": "",
          "evidence quote": "",
          reason: "the opening does not say the formal meeting name",
          confidence: 0,
        };
      }
      assert.match(retryReason, /formal meeting name/u);
      return {
        found: true,
        "atomic unit id": "atomic_000003",
        "evidence quote": "Committee of the Whole meeting",
        reason: "the canonical opening sequence identifies the target meeting",
        confidence: 0.97,
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(scope["scope atomic start"], "atomic_000003");
  assert.equal(scope["prefix atomic units"], 0);
});

test("reconciliation canonicalizes an LLM atomic id with omitted zero padding", () => {
  const disposition = normalizeDisposition({
    "agenda item": "4",
    status: "executed",
    "atomic unit id": "atomic_14",
    role: "minutes",
    "evidence quote": "confirmation of minutes",
    confidence: 0.92,
  });
  assert.equal(disposition["atomic unit id"], "atomic_000014");
});

test("reconciliation retries a blank empty status with the rejected shape and boundary contract", async () => {
  const canonical = { items: [{ item: "4", title: "Confirmation of Minutes" }] };
  const units = [{
    "atomic unit id": "atomic_000014",
    speaker: "CHAIR",
    text: "Not seeing any confirmation of minutes and there's two sets here.",
  }];
  const candidates = [{
    "agenda item": "4",
    "atomic unit id": "atomic_000014",
    role: "minutes",
    "evidence quote": "confirmation of minutes and there's two sets here",
    confidence: 0.92,
  }];
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const content = requests.length === 1
      ? { items: [{ "agenda item": "4", status: "empty", "atomic unit id": "", role: "", "evidence quote": "", confidence: 0 }] }
      : { items: [{ "agenda item": "4", status: "executed", "atomic unit id": "atomic_000014", role: "minutes", "evidence quote": "confirmation of minutes and there's two sets here", confidence: 0.92 }] };
    return new Response(JSON.stringify({ done_reason: "stop", message: { content: JSON.stringify(content) } }), { status: 200 });
  };
  try {
    const dispositions = await reconcileTimelineInBatches({
      canonical,
      candidates,
      units,
      llmModel: "qwen3.5:9b",
      ollamaUrl: "http://ollama.test/api/chat",
      log: () => {},
    });
    assert.equal(dispositions[0].status, "executed");
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages[1].content, /empty is boundary-bearing/iu);
    assert.match(requests[1].messages[1].content, /"status":"empty"/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reconciliation pins executable output to the validated candidate boundary", async () => {
  const canonical = { items: [{ item: "8.a.1", title: "First report" }] };
  const units = [
    { "atomic unit id": "atomic_000001", speaker: "CHAIR", text: "Item... next item." },
    { "atomic unit id": "atomic_000002", speaker: "CHAIR", text: "Our first report is from the City Manager." },
  ];
  const candidates = [{
    "agenda item": "8.a.1",
    "atomic unit id": "atomic_000001",
    role: "other",
    "evidence quote": units[0].text,
    confidence: 0.9,
  }];
  let requests = 0;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    requests += 1;
    const prompt = JSON.parse(options.body).messages[1].content;
    const exact = /validated candidate record is authoritative for the boundary/u.test(prompt);
    const content = exact
      ? { items: [{ "agenda item": "8.a.1", status: "executed", "atomic unit id": "atomic_000001", role: "other", "evidence quote": "Item... next item.", confidence: 0.9 }] }
      : { items: [{ "agenda item": "8.a.1", status: "executed", "atomic unit id": "atomic_000001", role: "other", "evidence quote": "Our first report is from the City Manager.", confidence: 0.9 }] };
    return new Response(JSON.stringify({ done_reason: "stop", message: { content: JSON.stringify(content) } }), { status: 200 });
  };
  try {
    const result = await reconcileTimelineInBatches({
      canonical,
      candidates,
      units,
      llmModel: "qwen3.5:9b",
      ollamaUrl: "http://ollama.test/api/chat",
      log: () => {},
    });
    assert.equal(result[0]["atomic unit id"], "atomic_000001");
    assert.equal(requests, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("named meeting scope excludes a following meeting using an LLM-grounded handoff", async () => {
  const { canonical, units } = scopeFixture();
  const scope = await locateCanonicalMeetingScopeEnd({
    canonical,
    units,
    meetingLabel: "County Council",
    scopeEndProvider: async () => ({
      found: true,
      "atomic unit id": "atomic_000003",
      "evidence quote": "Committee of the Whole meeting",
      "following meeting": "Committee of the Whole",
      reason: "the target adjourned and the following meeting was called to order",
      confidence: 0.97,
    }),
  });
  assert.equal(scope["scope atomic end"], "atomic_000002");
  assert.equal(scope["following meeting atomic start"], "atomic_000003");
  assert.equal(scope["suffix atomic units"], 2);
  assert.equal(scope["out of scope suffix"], true);
});

test("following-meeting handoff evidence may span adjacent atomic sentences", async () => {
  const { canonical, units } = scopeFixture();
  units[2].text = "We will take a moment to switch over to our committee.";
  units[3].text = "The whole.";
  const scope = await locateCanonicalMeetingScopeEnd({
    canonical,
    units,
    meetingLabel: "County Council",
    scopeEndProvider: async () => ({
      found: true,
      "atomic unit id": "atomic_000003",
      "evidence quote": "switch over to our committee. The whole.",
      "following meeting": "Committee of the Whole",
      reason: "explicit handoff after target meeting",
      confidence: 0.97,
    }),
  });
  assert.equal(scope["scope atomic end"], "atomic_000002");
  assert.equal(scope["following meeting atomic start"], "atomic_000003");
});

test("named meeting scope retains the recording tail when every LLM window rejects a following meeting", async () => {
  const { canonical, units } = scopeFixture();
  const scope = await locateCanonicalMeetingScopeEnd({
    canonical,
    units: units.slice(0, 2),
    meetingLabel: "County Council",
    scopeEndProvider: async () => ({
      found: false,
      "atomic unit id": "",
      "evidence quote": "",
      "following meeting": "",
      reason: "no separate following meeting in this window",
      confidence: 0,
    }),
  });
  assert.equal(scope["scope atomic end"], "atomic_000002");
  assert.equal(scope["suffix atomic units"], 0);
  assert.equal(scope["out of scope suffix"], false);
});

test("meeting scope end prompt requires an explicit handoff and rejects agenda references", () => {
  const prompt = buildMeetingScopeEndPrompt({
    canonical: { items: [{ item: "6.b", title: "Closed Committee minutes" }] },
    meetingLabel: "County Council",
    window: {
      "window id": "window_0001",
      text: "[atomic_000003] Chair: We will now begin Committee of the Whole.",
    },
  });
  assert.match(prompt, /explicit handoff to another named meeting/u);
  assert.match(prompt, /committee report, committee appointment, closed-session item, or minutes/u);
  assert.match(prompt, /first atomic unit belonging to the handoff or following meeting/u);
});

test("truncated Ollama JSON retries with bounded additional output capacity", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return new Response(JSON.stringify({
      done_reason: requests.length === 1 ? "length" : "stop",
      message: {
        content: requests.length === 1
          ? '{"transitions":[{"agenda item":"1"'
          : '{"transitions":[]}',
      },
    }), { status: 200 });
  };

  const parsed = await callOllamaJson({
    ollamaUrl: "http://ollama.test/api/chat",
    llmModel: "qwen3.5:9b",
    system: "Return JSON.",
    prompt: "Locate transitions.",
    attempts: 2,
    maxOutputTokens: 5000,
    fetchImpl,
  });

  assert.deepEqual(parsed, { transitions: [] });
  assert.deepEqual(requests.map((request) => request.model), ["qwen3.5:9b", "qwen3.5:9b"]);
  assert.deepEqual(requests.map((request) => request.options.num_predict), [5000, 10000]);
  assert.match(requests[1].messages[1].content, /previous response was truncated/u);
});

test("duplicate item boundaries prefer literal structured-title support", () => {
  const canonical = { items: [{ item: "8.b.1", title: "Community Impact Lab" }] };
  const candidates = [
    { "agenda item": "8.b.1", "atomic unit id": "atomic_000825", "evidence quote": "Go ahead, Ali.", confidence: 0.99 },
    { "agenda item": "8.b.1", "atomic unit id": "atomic_000847", "evidence quote": "The Community Impact Lab report is next.", confidence: 0.8 },
  ];
  assert.equal(dedupeCandidatesByAgendaItem(candidates, canonical)[0]["atomic unit id"], "atomic_000847");
});

test("deduplication keeps an independently refined focused start over a later chronology fragment", () => {
  const canonical = { items: [{ item: "7.b", title: "Housing Action Plan Status Update", level: 2, substantive: true }] };
  const result = dedupeCandidatesByAgendaItem([
    {
      "agenda item": "7.b",
      "atomic unit id": "atomic_000200",
      "evidence quote": "Community housing creators discussed financing.",
      confidence: 0.95,
      "semantic verification": "qwen3.5:9b complete-chronology segmentation with literal evidence",
    },
    {
      "agenda item": "7.b",
      "atomic unit id": "atomic_000100",
      "evidence quote": "The Housing Action Plan report is next.",
      confidence: 0.9,
      "focused recovery refined": true,
      "semantic verification": "qwen3.5:9b focused recovery with independent literal-boundary audit",
    },
  ], canonical);
  assert.equal(result.length, 1);
  assert.equal(result[0]["atomic unit id"], "atomic_000100");
});

test("a sole-child parent transition outranks a later title mention inside the presentation", () => {
  const canonical = { items: [{ item: "4.a", title: "Grey Bruce Ontario Health Team" }] };
  const candidates = [
    {
      "agenda item": "4.a",
      "atomic unit id": "atomic_000697",
      "evidence quote": "We will move on to the delegation",
      confidence: 0.95,
      "sole child promotion": true,
      "semantic verification": "complete-chronology segmentation; structured agenda sole-child ownership",
    },
    {
      "agenda item": "4.a",
      "atomic unit id": "atomic_001099",
      "evidence quote": "Ontario Health Team",
      confidence: 0.99,
      "semantic verification": "complete-chronology segmentation",
    },
  ];
  assert.equal(dedupeCandidatesByAgendaItem(candidates, canonical)[0]["atomic unit id"], "atomic_000697");
});

test("named meeting scope owns call to order over a later duplicate candidate", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-llm-segmentation.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Object\.assign\(callDisposition/u);
  const canonical = { items: [{ item: "1", title: "Call to Order" }] };
  const candidates = [
    {
      "agenda item": "1",
      "atomic unit id": "atomic_000683",
      "evidence quote": "call to order this committee",
      confidence: 0.95,
      "meeting scope boundary": true,
    },
    {
      "agenda item": "1",
      "atomic unit id": "atomic_000694",
      "evidence quote": "business arising from minutes",
      confidence: 0.99,
      "semantic verification": "complete-chronology segmentation",
    },
  ];
  assert.equal(dedupeCandidatesByAgendaItem(candidates, canonical)[0]["atomic unit id"], "atomic_000683");
});

test("LLM boundary evidence is rebound to the named atomic unit after minor paraphrase", () => {
  const candidate = alignEvidenceToAtomicUnit({
    "atomic unit id": "atomic_000344",
    "evidence quote": "That allows us to move on to our bylaws.",
  }, [{
    "atomic unit id": "atomic_000344",
    text: "That allows us to move to our",
  }]);
  assert.equal(candidate["evidence quote"], "That allows us to move to our");
});

test("split transition evidence rebinds from the final tiny unit to the first literal unit", () => {
  const units = [
    { "atomic unit id": "atomic_000001", text: "So we'll go to seven" },
    { "atomic unit id": "atomic_000002", text: "A." },
    { "atomic unit id": "atomic_000003", text: "It's recommended that the minutes be adopted." },
  ];
  const aligned = alignEvidenceToAtomicUnit({
    "agenda item": "7.a",
    "atomic unit id": "atomic_000002",
    "evidence quote": "So we'll go to seven A.",
    confidence: 0.95,
  }, units);
  assert.equal(aligned["atomic unit id"], "atomic_000001");
  assert.equal(aligned["evidence quote"], units[0].text);
});

test("shared consent boundary keeps the direct attachment owner", () => {
  const canonical = {
    items: [
      { item: "5", level: 1, substantive: false },
      { item: "5.a", level: 2, substantive: true },
      { item: "5.b", level: 2, substantive: false },
      { item: "6", level: 1, substantive: false },
    ],
  };
  const units = [
    { "atomic unit id": "atomic_000001", text: "We move to adoption of minutes." },
    { "atomic unit id": "atomic_000002", text: "The county council minutes are before us." },
    { "atomic unit id": "atomic_000003", text: "We move to closed meeting matters." },
  ];
  const dispositions = [
    { "agenda item": "5", status: "executed", "atomic unit id": "atomic_000001", role: "procedural", "evidence quote": "move to adoption", confidence: 0.95 },
    { "agenda item": "5.a", status: "executed", "atomic unit id": "atomic_000002", role: "minutes", "evidence quote": "county council minutes", confidence: 0.95 },
    { "agenda item": "5.b", status: "executed", "atomic unit id": "atomic_000002", role: "minutes", "evidence quote": "county council minutes", confidence: 0.92 },
    { "agenda item": "6", status: "executed", "atomic unit id": "atomic_000003", role: "closed_session", "evidence quote": "closed meeting matters", confidence: 0.95 },
  ];

  resolveSharedBoundaryOwnership(dispositions, canonical);
  assert.equal(dispositions[1].status, "executed");
  assert.equal(dispositions[2].status, "container");
  assert.equal(dispositions[2]["atomic unit id"], "");
  assert.doesNotThrow(() => validateReconciledTimeline(dispositions, canonical, units));
});

test("an executed child owns chronology instead of its parent heading", () => {
  const dispositions = [
    { "agenda item": "8", status: "executed", "atomic unit id": "atomic_000020", role: "staff_report", "evidence quote": "reports of city staff", confidence: 0.9 },
    { "agenda item": "8.a", status: "executed", "atomic unit id": "atomic_000030", role: "staff_report", "evidence quote": "transit report", confidence: 0.9 },
    { "agenda item": "8.a.1", status: "executed", "atomic unit id": "atomic_000040", role: "staff_report", "evidence quote": "continuation of transit", confidence: 0.9 },
  ];
  resolveCanonicalHierarchyOwnership(dispositions);
  assert.equal(dispositions[0].status, "container");
  assert.equal(dispositions[1].status, "container");
  assert.equal(dispositions[2].status, "executed");
});

test("a higher-confidence opening call does not also become a later agenda boundary", () => {
  const candidates = [
    { "agenda item": "2", "atomic unit id": "atomic_000004", confidence: 0.95 },
    { "agenda item": "12", "atomic unit id": "atomic_000004", confidence: 0.75 },
  ];
  const canonical = { items: [
    { item: "2", level: 1, substantive: false },
    { item: "12", level: 1, substantive: false },
  ] };
  assert.deepEqual(
    pruneConflictingBoundaryCandidates(candidates, canonical).map((entry) => entry["agenda item"]),
    ["2"],
  );
});

test("equally ambiguous empty category headings do not claim transcript ownership", () => {
  const candidates = [
    { "agenda item": "8.d", "atomic unit id": "atomic_000300", confidence: 0.9 },
    { "agenda item": "8.e", "atomic unit id": "atomic_000300", confidence: 0.9 },
  ];
  const canonical = { items: [
    { item: "8.d", level: 2, substantive: false },
    { item: "8.e", level: 2, substantive: false },
  ] };
  assert.deepEqual(pruneConflictingBoundaryCandidates(candidates, canonical), []);
});

test("ambiguous sibling ownership remains retryable", () => {
  const canonical = {
    items: [
      { item: "7.a", level: 2, substantive: true },
      { item: "7.b", level: 2, substantive: true },
    ],
  };
  const dispositions = [
    { "agenda item": "7.a", status: "executed", "atomic unit id": "atomic_000010", role: "staff_report", "evidence quote": "shared report", confidence: 0.9 },
    { "agenda item": "7.b", status: "executed", "atomic unit id": "atomic_000010", role: "staff_report", "evidence quote": "shared report", confidence: 0.9 },
  ];
  assert.throws(
    () => resolveSharedBoundaryOwnership(dispositions, canonical),
    /ambiguous shared boundary/u,
  );
});

test("oversized ASR rows are split only from verbatim LLM spans", async () => {
  const source = "First agenda item closes here and the next agenda item starts here with a report introduction";
  const units = await splitOversizedTranscriptUnits([{
    "atomic unit id": "atomic_000001",
    "atomic index": 0,
    since: 10,
    until: 20,
    text: source,
  }], {
    maxWords: 5,
    segmentProvider: async () => ({
      segments: [
        "First agenda item closes here",
        "and the next agenda item starts here with a report introduction",
      ],
    }),
  });
  assert.deepEqual(units.map((unit) => unit.text), [
    "First agenda item closes here",
    "and the next agenda item starts here with a report introduction",
  ]);
  assert.deepEqual(units.map((unit) => unit["atomic unit id"]), ["atomic_000001", "atomic_000002"]);
});
