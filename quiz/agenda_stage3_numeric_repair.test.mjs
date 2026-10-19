import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_TEXT_MODEL } from "../program/runtime/gpu/text-model.mjs";

import {
  numericAuditSourceExcerpt,
  adjudicateChapterOrthogonality,
  adjudicateGroundedSummaryLlm,
  auditGroundedSummaryLlm,
  confirmLiteralGroundingLlm,
  repairChapterTitleLlm,
  repairNumericFidelityLlm,
  repairUnsupportedNumericClaimsLlm,
  rewriteWithoutNumericClaimsLlm,
  scopeSourceAtStructuredHandoff,
  stage3GenerationOrder,
  summarizeGroundedUnit,
} from "../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs";

test("stage3 grounding adjudication rechecks semantic allegations against literal source", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({ grounded: true, "unsupported claims": [], notes: "The source states consent agenda and the motion outcome." }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await adjudicateGroundedSummaryLlm({
    label: "11.g Correspondence",
    summary: "The motion received items 11 A to 11 G as part of the consent agenda.",
    sourceExcerpt: "SPEAKER_078: The motion on the September twenty-eight consent agenda received items 11 A to 11 G. That's carried.",
    priorAudit: {
      grounded: false,
      unsupportedClaims: ["consent agenda is not in the source"],
      notes: "The first audit rejected the category.",
    },
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.unsupportedClaims, []);
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
  assert.doesNotMatch(requestBody.messages[1].content, /SPEAKER_078:/u);
  assert.match(requestBody.messages[1].content, /prior audit is only an allegation and may be wrong/iu);
  assert.match(requestBody.messages[1].content, /Before marking a candidate claim absent.*complete GROUNDED_SOURCE/iu);
  assert.match(requestBody.messages[1].content, /multiple procedural phases.*closed session.*return to open session/iu);
  assert.match(requestBody.messages[1].content, /'In the closed session'.*'no direction was provided'.*open-session discussion/iu);
  assert.match(requestBody.messages[1].content, /compact neutral preposition.*regarding/iu);
  assert.match(requestBody.messages[1].content, /preserve qualifiers.*'acted upon or have been completed'.*'virtually'.*'erased'/iu);
  assert.match(requestBody.messages[1].content, /'I am going to vote against that'.*intention or opposition.*vote was completed/iu);
  assert.match(requestBody.messages[1].content, /Generic presentation framing is a faithful paraphrase/iu);
  assert.match(requestBody.messages[1].content, /Generic actor compression such as 'one councillor'/iu);
  assert.match(requestBody.messages[1].content, /agenda label.*category/u);
  assert.match(requestBody.messages[1].content, /item-owning committee/u);
  assert.match(requestBody.messages[1].content, /structural framing/u);
  assert.match(requestBody.messages[1].content, /document identity or title framing/u);
  assert.match(requestBody.messages[1].content, /goodbye.*farewell/iu);
  assert.match(requestBody.messages[1].content, /do not infer that every named person spoke/iu);
  assert.match(requestBody.messages[1].content, /speaker identifiers are internal metadata/iu);
  assert.match(requestBody.messages[1].content, /inspect CANDIDATE_SUMMARY and its chapter text separately from GROUNDED_SOURCE/iu);
  assert.match(requestBody.messages[1].content, /do not require an internal transcript speaker identifier/iu);
  assert.match(requestBody.messages[1].content, /preserve qualified absences exactly/iu);
  assert.match(requestBody.messages[1].content, /current agenda item is minutes of another committee/iu);
  assert.match(requestBody.messages[1].content, /current-meeting motion to move, adopt, receive, or approve/iu);
  assert.match(requestBody.messages[1].content, /If the source says 'move the minutes'.*do not upgrade it to 'approve'/iu);
  assert.match(requestBody.messages[1].content, /Narrative before the current meeting's minutes motion is content of the referenced minutes/iu);
  assert.match(requestBody.messages[1].content, /literal self-report.*may be summarized as a speaker saying/iu);
  assert.match(requestBody.messages[1].content, /distinguish a substantive amendment to a bylaw/iu);
  assert.match(requestBody.messages[1].content, /never say that the rejected motion amendment carried/iu);
  assert.match(requestBody.messages[1].content, /motion to amend the named bylaw.*can carry even when a proposed amendment to that motion does not/iu);
  assert.match(requestBody.messages[1].content, /do not misread 'no amendment was made to the motion'.*no substantive document amendment was approved/iu);
  assert.match(requestBody.messages[1].content, /A document-qualified claim.*is not a claim.*accept it/iu);
  assert.match(requestBody.messages[1].content, /document-qualified claim.*approved an amendment to the named bylaw.*not a claim that the body approved an amendment to the motion/iu);
  assert.match(requestBody.messages[1].content, /category in a list does not inherit a later motion/iu);
  assert.match(requestBody.messages[1].content, /bare agenda-category list.*do not infer a staff report/iu);
  assert.match(requestBody.messages[1].content, /no specific disposition is recorded/iu);
  assert.match(requestBody.messages[1].content, /several parallel agenda items/iu);
  assert.match(requestBody.messages[1].content, /do not say it was under, within, part of, or subordinate/iu);
  assert.match(requestBody.messages[1].content, /reports that another body previously approved/iu);
  assert.match(requestBody.messages[1].content, /do not describe the current meeting as approving the underlying matter/iu);
  assert.match(requestBody.messages[1].content, /generic member of that body may be used for the motion/iu);
  assert.match(requestBody.messages[1].content, /do not demand the literal word council in the transcript/iu);
  assert.match(requestBody.messages[1].content, /'it is passed'.*'that is passed'.*numeric vote count/iu);
  assert.match(requestBody.messages[1].content, /moving a recommendation.*'move the recommendation contained in the report'.*carried or passed/iu);
  assert.match(requestBody.messages[1].content, /Council Meeting - Regular/iu);
  assert.match(requestBody.messages[1].content, /stop at the first explicit child handoff/iu);
  assert.match(requestBody.messages[1].content, /do not copy the child agenda code/iu);
  assert.match(requestBody.messages[1].content, /named presenter or organization identifies the agenda item/iu);
  assert.match(requestBody.messages[1].content, /do not infer that every named person spoke/iu);
  assert.match(requestBody.messages[1].content, /people named in an agenda label are identity metadata only/iu);
  assert.match(requestBody.messages[1].content, /never copy a parent agenda title's parenthetical list of people/iu);
  assert.match(requestBody.messages[1].content, /preserve temporal direction exactly/iu);
  assert.match(requestBody.messages[1].content, /preserve occupation and status exactly/iu);
  assert.match(requestBody.messages[1].content, /event host explicitly says.*I'll start with inviting/iu);
  assert.match(requestBody.messages[1].content, /keep every number, tenure, quote, role, and achievement attached/iu);
  assert.match(requestBody.messages[1].content, /generic plural may summarize two or more explicitly sourced people/iu);
  assert.match(requestBody.messages[1].content, /preserve the source speech act and status/iu);
  assert.match(requestBody.messages[1].content, /name followed by 'from' an organization/iu);
  assert.match(requestBody.messages[1].content, /floor handoff.*affirmative/iu);
  assert.match(requestBody.messages[1].content, /ordinary discussion, comments, reactions, feasibility talk.*do not establish a formal institutional agreement.*Do not use addressed, tackled, resolved/isu);
  assert.match(requestBody.messages[1].content, /motion to defer or postpone.*defeated/iu);
  assert.match(requestBody.messages[1].content, /do not say that the item itself was deferred or postponed/iu);
  assert.match(requestBody.messages[1].content, /discussion is on the motion to reconsider only/iu);
  assert.match(requestBody.messages[1].content, /accept the reconsideration as carried even without a numeric vote count/iu);
  assert.match(requestBody.messages[1].content, /moved by myself.*generic attribution/iu);
  assert.match(requestBody.messages[1].content, /treat ambiguous procedural remarks/iu);
  assert.match(requestBody.messages[1].content, /summarize the listed item neutrally/iu);
  assert.match(requestBody.messages[1].content, /explicit procedural inquiry followed by a literal no-response observation/iu);
  assert.match(requestBody.messages[1].content, /current agenda label is the binding scope/iu);
  assert.match(requestBody.messages[1].content, /first explicit sentence that announces a different report or agenda item/iu);
  assert.match(requestBody.messages[1].content, /exception for literal consent agendas/iu);
  assert.match(requestBody.messages[1].content, /omission of a supported later outcome/iu);
  assert.match(requestBody.messages[1].content, /consent agenda/u);
  assert.match(requestBody.messages[1].content, /conservative omission/iu);
  assert.match(requestBody.messages[1].content, /keep the layers separate/iu);
  assert.match(requestBody.messages[1].content, /later nomination or acclamation is a separate action/iu);
  assert.match(requestBody.messages[1].content, /proposal and that later procedural status as separate source-supported facts/iu);
});

test("stage3 uses a minimal literal-source tie-breaker for contradictory audit prose", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({ grounded: true, "unsupported claims": [], notes: "Every listed claim appears in the source." }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await confirmLiteralGroundingLlm({
    label: "11.l Final approvals",
    summary: "Licences were issued to three named businesses and illumination requests were approved.",
    sourceExcerpt: "Licences were issued to three named businesses. Illumination requests were approved.",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.grounded, true);
  assert.match(requestBody.messages[1].content, /Check every sentence and list element/iu);
  assert.match(requestBody.messages[1].content, /If the source contains the claim, do not report it as absent/iu);
  assert.match(requestBody.messages[1].content, /A document-qualified claim.*is not a claim.*accept it/iu);
  assert.match(requestBody.messages[1].content, /Do not reject that document-qualified claim solely because a separate motion amendment was rejected/iu);
});

test("stage3 keeps incidental public-forum mentions from becoming forum-wide topics", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "A public forum gave residents an opportunity to raise concerns and requests.",
              "chapter text": "Residents raise public concerns",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_public_forum",
      label: "8 PUBLIC FORUM",
      "source excerpt": "A speaker mentioned collecting material from downtown streets before discussing homelessness and shelter access.",
      "source rows": 4,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.match(requestBody.messages[1].content, /public forum or other open testimony/iu);
  assert.match(requestBody.messages[1].content, /passing mention of a place, object, personal background, or evidence collection/iu);
  assert.match(requestBody.messages[1].content, /named presenter or organization identifies the agenda item/iu);
  assert.match(requestBody.messages[1].content, /people named in an agenda label are identity metadata only/iu);
  assert.match(requestBody.messages[1].content, /never copy a parent agenda title's parenthetical list of people/iu);
  assert.match(requestBody.messages[1].content, /preserve temporal direction exactly/iu);
  assert.match(requestBody.messages[1].content, /preserve occupation and status exactly/iu);
  assert.match(requestBody.messages[1].content, /event host explicitly says.*I'll start with inviting/iu);
  assert.match(requestBody.messages[1].content, /keep every number, tenure, quote, role, and achievement attached/iu);
  assert.match(requestBody.messages[1].content, /standalone name or title callout.*floor handoff/iu);
  assert.match(requestBody.messages[1].content, /generic plural may summarize two or more explicitly sourced people/iu);
  assert.match(requestBody.messages[1].content, /preserve the source speech act and status/iu);
  assert.match(requestBody.messages[1].content, /moved by myself.*generic attribution/iu);
  assert.match(requestBody.messages[1].content, /treat ambiguous procedural remarks/iu);
  assert.match(requestBody.messages[1].content, /summarize the listed item neutrally/iu);
  assert.match(requestBody.messages[1].content, /explicit procedural inquiry followed by a literal no-response observation/iu);
  assert.match(requestBody.messages[1].content, /current agenda label is the binding scope/iu);
  assert.match(requestBody.messages[1].content, /first explicit sentence that announces a different report or agenda item/iu);
  assert.match(requestBody.messages[1].content, /exception for literal consent agendas/iu);
});

test("stage3 repairs merged discussion scope across separate transcript remarks", async (t) => {
  const requests = [];
  let groundingAudits = 0;
  let separateRepairs = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const system = body.messages?.[0]?.content || "";
    const prompt = body.messages?.[1]?.content || "";
    if (/^Audit one generated civic summary/iu.test(system)
      || /^Adjudicate a disputed civic-summary/iu.test(system)
      || /^Perform one final literal-source/iu.test(system)) {
      groundingAudits += 1;
      const grounded = groundingAudits > 3;
      return {
        ok: true,
        async json() {
          return {
            message: {
              content: JSON.stringify(grounded
                ? { grounded: true, "unsupported claims": [], notes: "" }
                : {
                  grounded: false,
                  "unsupported claims": ["The candidate combines distinct speaker remarks into one discussion."],
                  notes: "The source records separate remarks and does not record one unified discussion linking them.",
                }),
            },
          };
        },
      };
    }
    if (/keeps separate transcript remarks/iu.test(system)) {
      separateRepairs += 1;
      return {
        ok: true,
        async json() {
          return {
            message: {
              content: JSON.stringify({
                summary: "A speaker asked about shop rates. Another speaker described collective-agreement requirements.",
                "chapter text": "Questions address shop rates and collective agreements",
                confidence: 0.9,
                notes: "",
              }),
            },
          };
        },
      };
    }
    if (/^Produce strict JSON only/iu.test(system)) {
      return {
        ok: true,
        async json() {
          return {
            message: {
              content: JSON.stringify({
                summary: "A discussion regarding shop rates and collective agreement requirements was recorded.",
                "chapter text": "Discussion covers shop rates and collective agreements",
                confidence: 0.9,
                notes: "",
              }),
            },
          };
        },
      };
    }
    throw new Error(`unexpected stage3 test request: ${system} ${prompt.slice(0, 80)}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_separate_remarks",
      label: "3.a Draft budget",
      "source excerpt": "SPEAKER_1: What is our shop rate?\nSPEAKER_2: The collective agreement governs vacation and sick leave.",
      "source rows": 20,
      "duration seconds": 600,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(separateRepairs, 1);
  assert.match(result.summary, /shop rates/iu);
  assert.match(result.summary, /collective-agreement requirements/iu);
  assert.ok(requests.some((body) => /SEPARATE-REMARKS SCOPE RULE/iu.test(body.messages?.[1]?.content || "")));
  assert.ok(requests.some((body) => /Do not compress facts from separate blocks/iu.test(body.messages?.[1]?.content || "")));
});

test("stage3 treats attachment prose as document content rather than meeting dialogue", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The notice states that an electronic appeal hearing was scheduled and sets requirements for documentary evidence.",
              "chapter text": "Notice sets appeal hearing requirements",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_attachment_document",
      label: "7.a Appeal of Property Standards Order",
      "source excerpt": "Attachment: Notice of Appeal Hearing.pdf\nSource: https://example.invalid/notice.pdf\nTake notice that an appeal hearing has been scheduled. Questions of clarification may be asked by the parties.\nEmail from Customer Service Team: We found a new contractor for the job.",
      "source rows": 4,
      "duration seconds": 600,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.match(requestBody.messages[1].content, /attachment.*document.*not.*meeting transcript/iu);
  assert.match(requestBody.messages[1].content, /questions of clarification may be asked.*not evidence that anyone asked or answered/iu);
  assert.match(requestBody.messages[1].content, /declarative capability or availability statement.*not a question or request/iu);
  assert.match(requestBody.messages[1].content, /the City asked/iu);
  assert.match(requestBody.messages[1].content, /separately listed formal remedies.*not join them with.*due to/iu);
  assert.match(requestBody.messages[1].content, /reduced summaries and canonical document evidence differ.*trust the canonical evidence/iu);
  assert.match(requestBody.messages[1].content, /high-priority conservative document audit rule.*omission is not a grounding defect/iu);
  assert.match(requestBody.messages[1].content, /email.*correspondence.*recorded sender/iu);
  assert.match(requestBody.messages[1].content, /formal request.*neutral paraphrase.*requested confirmation/iu);
  assert.match(requestBody.messages[1].content, /legal addressee is implicit.*additional requested remedies/iu);
  assert.match(requestBody.messages[0].content, /document-only.*generation/iu);
  assert.match(requestBody.messages[1].content, /document-only generation contract/iu);
  assert.match(requestBody.messages[1].content, /neutral document framing/iu);
});

test("stage3 detects email-only document chunks without an attachment header", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The email reported that a contractor had been found.",
              "chapter text": "Email reports contractor update",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_email_chunk",
      label: "7.a Appeal correspondence",
      "source excerpt": "Reduction 1: A contractor update was reported.",
      "semantic grounding source excerpt": "Page 3\nReceived email from admin@example.com stating: We found a new contractor for this job.\nCUSTOMER SERVICE TEAM\nadmin@example.com",
      "source rows": 4,
      "duration seconds": 600,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.match(requestBody.messages[0].content, /document-only.*generation/iu);
  assert.match(requestBody.messages[1].content, /explicit sender.*never call that sender 'the speaker'/iu);
  assert.match(requestBody.messages[1].content, /canonical document evidence.*authoritative/iu);
});

test("stage3 repairs generic speaker attribution in reduced document summaries", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const summary = requests.length === 1
      ? "The speaker reported that a new contractor was found."
      : "The email reported that a new contractor was found.";
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary,
              "chapter text": "Email reports contractor update",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_document_speech_act",
      label: "7.a Appeal correspondence",
      "source excerpt": "Reduction 1: A contractor update was reported.",
      "semantic grounding source excerpt": "Received email from admin@example.com stating: We found a new contractor for this job. CUSTOMER SERVICE TEAM",
      "source rows": 4,
      "duration seconds": 600,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "The email reported that a new contractor was found.");
  assert.ok(requests.length >= 2);
  assert.match(requests[1].messages[1].content, /document speech-act repair/iu);
});

test("stage3 child prompts use the item code instead of parent participant labels", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The source records remarks about public service.",
              "chapter text": "Remarks reflect on public service",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_child_label",
      "agenda item": "7.a",
      label: "7.a Presentation from the City Manager Re: Celebration (Councillor Farmer, Councillor Dodd)",
      "source excerpt": "The source records remarks about public service.",
      "source rows": 2,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    isChild: true,
  });

  assert.match(requestBody.messages[1].content, /Label: 7\.a/u);
  assert.doesNotMatch(requestBody.messages[1].content, /Councillor Farmer|Councillor Dodd/u);
});

test("stage3 retries LLM prose that exposes internal transcript speaker identifiers", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 2) assert.match(request.messages[1].content, /speaker-metadata retry/iu);
    const summary = calls === 1
      ? "SPEAKER_060 discussed community involvement."
      : "The speaker discussed community involvement.";
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary,
              "chapter text": "Community involvement discussed",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_speaker_metadata",
      "agenda item": "7.a",
      label: "7.a Presentation",
      "source excerpt": "SPEAKER_060: The speaker discussed community involvement.",
      "source rows": 2,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "The speaker discussed community involvement.");
  assert.ok(calls >= 2);
  assert.doesNotMatch(result.summary, /SPEAKER_/u);
});

test("stage3 adjudicates duplication allegations against distinct literal source facets", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { message: { content: JSON.stringify({ distinct: true }) } };
    },
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await adjudicateChapterOrthogonality({
    heading: "8.a Report",
    chapters: [
      { title: "Drainage findings", text: "The report identifies drainage concerns.", "source excerpt": "Drainage concerns require a grading plan." },
      { title: "Traffic conditions", text: "The report identifies traffic conditions.", "source excerpt": "Traffic conditions require a management plan." },
    ],
    audit: { orthogonal: false, duplicateIndices: [0], notes: "overlap" },
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.deepEqual(result, { orthogonal: true, duplicateIndices: [], notes: "" });
});

test("stage3 varies invalid child-title repairs with the rejected headline", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 2) assert.match(request.messages[1].content, /REJECTED HEADLINE/u);
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          title: calls === 1 ? "Too short" : "Council approves funding for affordable housing plan",
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const title = await repairChapterTitleLlm({
    heading: "7.f Affordable Housing Plan",
    summary: "Council approved the affordable housing plan.",
    sourceExcerpt: "Council approved the affordable housing plan and directed staff to proceed.",
    auditNote: "Headline was too short.",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(calls, 2);
  assert.equal(title, "Council Approves Funding for Affordable Housing Plan");
});

test("stage3 keeps varied child-title repair bounded beyond the first three invalid drafts", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 4) {
      assert.match(request.messages[1].content, /short, direct subject-action-outcome headline/u);
      assert.match(request.messages[1].content, /REJECTED HEADLINE/u);
      assert.match(request.messages[1].content, /received 0 words/u);
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          title: calls < 4 ? "The discussion continues" : "Council Advances The Community Housing Plan",
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const title = await repairChapterTitleLlm({
    heading: "10.e Report",
    summary: "Council advanced the community housing plan.",
    sourceExcerpt: "Council advanced the community housing plan and directed staff to continue implementation.",
    auditNote: "The generated headline was unfinished.",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(calls, 4);
  assert.equal(title, "Council Advances the Community Housing Plan");
});

test("stage3 can ask qwen for grounded prose with no numeric claims", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Council returned to open session and reported that no direction was provided.",
              "chapter text": "Return to open session",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await rewriteWithoutNumericClaimsLlm({
    summary: "Council returned at nine seventeen.",
    chapterText: "Nine seventeen return",
    sourceExcerpt: "Council returned to open session and reported that no direction was provided.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "Council returned to open session and reported that no direction was provided.");
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
  assert.match(requestBody.messages[1].content, /Do not write any digits/u);
});

test("stage3 varies qualitative retries instead of repeating a failed numeric prompt", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    if (calls === 3) {
      assert.match(prompt, /Correction attempt 3 of 6/u);
      assert.match(prompt, /Start both fields over as fresh qualitative civic prose/u);
      assert.match(prompt, /GROUNDED_SOURCE: The committee discussed a countywide library service review/u);
      assert.doesNotMatch(prompt, /PRIOR_SUMMARY:/u);
    }
    const content = calls < 3
      ? {
          summary: "The review compared seven six million with three million in library spending.",
          "chapter text": "Seven six million library comparison",
        }
      : {
          summary: "The committee supported a review of countywide library services after discussing differing municipal costs and service models.",
          "chapter text": "Countywide library service review",
        };
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await rewriteWithoutNumericClaimsLlm({
    summary: "The review compared seven six million with three million in library spending.",
    chapterText: "Seven six million library comparison",
    sourceExcerpt: "The committee discussed a countywide library service review.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 3);
  assert.match(result.summary, /supported a review of countywide library services/u);
  assert.doesNotMatch(`${result.summary} ${result.chapterText}`, /\d/u);
});

test("qualitative numeric retries name rejected grounded address phrases", async (t) => {
  let prompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).messages[1].content;
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          summary: "Council discussed the negotiations.",
          "chapter text": "Negotiations continued",
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await rewriteWithoutNumericClaimsLlm({
    summary: "Council discussed 846 and 848 First Avenue West.",
    chapterText: "First Avenue negotiations",
    sourceExcerpt: "Council discussed negotiations.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.match(prompt, /First Avenue/u);
  assert.match(prompt, /do not repeat them or any close variant/u);
});

test("Owen Stage 3 delegates availability retries to the model-specific renderer", () => {
  const source = fs.readFileSync(
    new URL("../world/house/owen-sound-reporter/program/summarize-agenda-wise-sections-from-transcript-folder.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\/api\/tags/u);
  assert.match(source, /runAgendaStage3SummaryRenderer/u);
});

test("stage3 duplication repairs retain sibling summaries as grounding context", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /siblingSummaries:\s*chapterSiblingContext\(existingChapters,\s*ci,\s*Boolean\(auditNote\)\)/u);
  assert.match(source, /sibling summaries only to avoid repeating their facts, never as source evidence/u);
  assert.match(source, /FORBIDDEN ALREADY-COVERED CLAIMS/u);
  assert.match(source, /necessary repetition of the same overall report outcome or approval conditions are allowed/u);
  assert.match(source, /different source facets as distinct coverage/u);
  assert.match(source, /Orthogonality repair/u);
  assert.match(source, /REJECTED_CHAPTER_SUMMARY/u);
  assert.doesNotMatch(source, /fallbackUnitSummaryFrom(?:Grounding|Label)/u);
});

test("stage3 semantic audits retain middle source evidence", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('abridgeUtf8(String(chapter?.["source excerpt"] || ""), ORTHOGONALITY_SOURCE_WINDOW_CHARS)'));
  assert.match(source, /const middleBytes = Math\.floor\(limit \* 0\.4\)/u);
  assert.match(source, /Math\.floor\(\(bytes\.length - middleBytes\) \/ 2\)/u);
  assert.match(source, /const ORTHOGONALITY_SOURCE_WINDOW_CHARS = 3000/u);
  assert.match(source, /const ORTHOGONALITY_SUMMARY_WINDOW_CHARS = 1800/u);
  assert.match(source, /const auditBatchSize = chapters\.length > 2 \? 2 : chapters\.length/u);
  assert.match(source, /semantic grounding source excerpt/u);
  assert.match(source, /canonicalSourceEvidence/u);
  assert.match(source, /complete child evidence fits one bounded model request/u);
});

test("stage3 semantic audits use bounded object schemas", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  const auditStart = source.indexOf("async function auditChapterOrthogonality");
  const adjudicationStart = source.indexOf("export async function adjudicateChapterOrthogonality");
  assert.ok(auditStart >= 0);
  assert.ok(adjudicationStart > auditStart);
  const auditBlock = source.slice(auditStart, adjudicationStart);
  assert.match(auditBlock, /format: STAGE3_ORTHOGONALITY_RESPONSE_FORMAT/u);
  assert.match(source.slice(adjudicationStart), /format: STAGE3_ORTHOGONALITY_ADJUDICATION_RESPONSE_FORMAT/u);
});

test("stage3 JSON retries discard oversized malformed responses instead of echoing source tails", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /lastMalformedContent\.length <= 2000/u);
  assert.match(source, /response was oversized or truncated/u);
});

test("stage3 JSON retries vary the generation after an empty model response", async (t) => {
  let calls = 0;
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    requests.push(request);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: calls <= 2
              ? ""
              : JSON.stringify({ grounded: true, "unsupported claims": [], notes: "" }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await auditGroundedSummaryLlm({
    label: "8.b Outdoor Advertising",
    summary: "The committee discussed outdoor advertising.",
    sourceExcerpt: "The committee discussed the city's outdoor advertising agreement.",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.test/api/chat",
  });

  assert.deepEqual(result, { grounded: true, unsupportedClaims: [], notes: "" });
  assert.equal(calls, 3);
  assert.equal(requests[0].options.num_predict, 420);
  assert.equal(requests[1].options.num_predict, 840);
  assert.equal(requests[1].options.seed, 2);
  assert.equal(requests[1].options.temperature, 0.1);
  assert.equal(requests[2].options.num_predict, 840);
  assert.equal(requests[2].options.seed, 3);
  assert.ok(Math.abs(requests[2].options.temperature - 0.15) < 1e-9);
  assert.match(requests[2].messages[1].content, /smallest complete object/u);
});

test("stage3 repeats the category-fragment contract in short non-substantive repairs", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const shortCategoryFragment = sourceExcerptText\.length <= 1000/u);
  assert.match(source, /Short non-substantive category-fragment repair/u);
  assert.match(source, /Return only fresh neutral LLM prose/u);
});

test("stage3 keeps a collective category carry separate from the current category", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["each listed category was carried"], notes: "The source only gives a collective procedural follow-up." };
    } else if (prompt.includes("Conservative agenda-category-fragment repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The transcript lists matters postponed among several agenda categories; no specific disposition is recorded for this item.",
        "chapter text": "Agenda categories listed without item disposition",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary")) {
      content = { grounded: false, "unsupported claims": ["each listed category was carried"], notes: "The source only gives a collective procedural follow-up." };
    } else {
      content = {
        summary: "The consent agenda, committee minutes, matters postponed, notices, and additional business were carried by a favorable vote.",
        "chapter text": "Agenda categories carried by favorable vote",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_category_carry",
      label: "13 MATTERS POSTPONED",
      role: "other",
      status: "executed",
      "source excerpt": "consent agenda, committee minutes, matters postponed, motions for which notice was previously given, and additional business. And all in favour, and that is carried. Thank you. So we're in Committee of the Whole. At number six, we have no public meetings.",
      "source rows": 5,
      "duration seconds": 14,
      substantive: true,
      "child chapters": [],
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /no specific disposition is recorded/iu);
  assert.match(repairPrompt, /Conservative agenda-category-fragment repair/iu);
  assert.match(repairPrompt, /do not report the trailing generic 'carried' phrase as an action/iu);
  assert.match(repairPrompt, /named member moved the list/iu);
  assert.match(repairPrompt, /INDEPENDENT_AUDIT_REJECTION/iu);
  assert.ok(calls >= 3);
});

test("stage3 repairs inferred roles when correspondence speakers are not explicitly identified", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative role-attribution repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "A speaker raised concerns about correspondence language and asked how staff screen requests for inclusion on the agenda; another speaker described the applicable procedural-bylaw provisions and routing practice.",
        "chapter text": "Correspondence screening and routing discussed",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary") || prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY") || prompt.includes("The prior audit is only an allegation")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["a council member raised concerns"], notes: "The source does not explicitly pair that role with the remarks." };
    } else {
      content = {
        summary: "A council member raised concerns about correspondence language and staff clarified the screening process.",
        "chapter text": "Council member raised correspondence concerns",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const correspondenceSource = [
    "A speaker discussed correspondence sent to the Mayor and Council, raised concerns about injurious language, and asked a question for staff about how requests are screened for inclusion.",
    "Another speaker described procedural-bylaw provisions for withholding inappropriate material and explained the routing practice for emails.",
    "The correspondence discussion continued with source-supported questions about inclusion, screening, routing, and the applicable procedural provisions.",
    "The speakers described the correspondence process, the request for agenda inclusion, and the distinction between official correspondence and material routed for follow-up.",
    "The bounded source records the correspondence discussion and its screening and routing explanations without identifying every speaker's office.",
    "The discussion also records the concern that official correspondence should reach the Clerk while advertisements and product offers may be routed to staff for follow-up, preserving the distinction between material presented for information and material handled through ordinary administrative channels.",
  ].join(" ");
  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_correspondence_role",
      label: "11.h Correspondence received which is presented for the information of Council",
      role: "other",
      status: "executed",
      "source excerpt": correspondenceSource,
      "source rows": 108,
      "duration seconds": 710,
      substantive: true,
      "child chapters": [],
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /A speaker raised concerns/iu);
  assert.doesNotMatch(result.summary, /council member/iu);
  assert.match(repairPrompt, /Conservative role-attribution repair/iu);
  assert.match(repairPrompt, /Role-attribution fidelity is strict/iu);
  assert.match(repairPrompt, /ROLE-NEUTRAL OUTPUT CONTRACT/iu);
  assert.match(repairPrompt, /ABSOLUTE ROLE BLOCKLIST/iu);
  assert.match(repairPrompt, /rejected candidate is untrusted repair context/iu);
  assert.match(repairPrompt, /REJECTED_CANDIDATE \(UNTRUSTED AND BLOCKLISTED\)/iu);
  assert.match(repairPrompt, /addressed to the Mayor or Council/iu);
  assert.match(repairPrompt, /A name or title that appears inside a labeled speaker's dialogue is not automatically that speaker/iu);
  assert.match(repairPrompt, /do not treat a shared surname or substring as proof/iu);
  assert.match(repairPrompt, /ACTOR-CLAUSE OMISSION PRIORITY/iu);
  assert.match(repairPrompt, /do not satisfy the repair by substituting 'a speaker'/iu);
  assert.match(repairPrompt, /never merge facts from separate labeled speaker blocks/iu);
  assert.match(repairPrompt, /generic 'a speaker' may cover only facts anchored to one source block/iu);
  assert.match(repairPrompt, /Procedural verbs such as moved, seconded, carried, or defeated attach only to the immediately stated motion subject/iu);
  assert.match(repairPrompt, /do not write that a motion was seconded for discussion of a separate topic/iu);
  assert.match(repairPrompt, /removing an expenditure or budget line is not removing the underlying service, software, platform/iu);
  assert.match(repairPrompt, /An opportunity, invitation, or statement that someone may move or defer something is not itself a proposed amendment/iu);
  assert.match(repairPrompt, /displayed transcript speaker label spans a direct-address question/iu);
  assert.match(repairPrompt, /do not name the addressee as mover or seconder/iu);
  assert.match(repairPrompt, /later paraphrase of the motion within the same ambiguous dialogue/iu);
  const rendererSource = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(rendererSource, /SYSTEM-LEVEL ROLE BLOCKLIST: the audit rejected a speaker title/u);
  assert.match(rendererSource, /AUDIT-TYPE ROLE REPAIR: do not output any rejected title/u);
  assert.match(rendererSource, /Parent-overview role rule: literal source anchors outrank child-summary coverage aids/u);
  assert.match(rendererSource, /preserve named speakers only when the paired literal source anchor explicitly supports the name-role pairing/u);
  assert.match(rendererSource, /Conditional\/contrast repair: preserve the source's logical relationship exactly/u);
  assert.match(rendererSource, /do not rewrite it as a before\/after sequence/u);
  assert.match(rendererSource, /Treat each transcript display label as literal evidence only for the text under that label/iu);
  assert.match(rendererSource, /do not normalize a name or spelling variant into a different titled actor/iu);
  assert.match(rendererSource, /Preserve proposal strength exactly/iu);
  assert.match(rendererSource, /when the distinction is uncertain, preserve the speaker's qualified statement or say only that the source records discussion/iu);
  assert.match(rendererSource, /Keep a proposed amendment distinct from a motion to amend/iu);
  assert.match(rendererSource, /If speaker or role alignment remains uncertain after the audit/iu);
  assert.ok(calls >= 3);
});

test("stage3 financial audits exclude echoed auxiliary source text", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /candidateText: summary/u);
  assert.match(source, /raw field here can trigger a false financial audit/u);
});

test("stage3 keeps requested funding and repair costs distinct from savings", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Additional funding, budget increases, repair or project costs.*not savings or reductions/u);
  assert.match(source, /does not convert a requested amount into savings/u);
  assert.match(source, /Keep every amount attached to the source category that governs it/u);
});

test("stage3 generates compact units first while retaining canonical indexes", () => {
  const units = [
    { "source chars": 30000 },
    { "source chars": 700 },
    { "source chars": 12000 },
  ];
  assert.deepEqual(stage3GenerationOrder(units).map((entry) => entry.index), [1, 2, 0]);
});

test("stage3 sentence budgets do not split at the abbreviation By-law No.", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        message: {
          content: JSON.stringify({
            summary: "Council considers By-law No. 2026-097 to establish the reserve as a public highway.",
            "chapter text": "Public highway reserve",
            confidence: 0.9,
            notes: "",
          }),
        },
      };
    },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_bylaw",
      label: "By-law No. 2026-097",
      "source excerpt": "By-law No. 2026-097 would establish the reserve as a public highway.",
      "source rows": 2,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(
    result.summary,
    "Council considers By-law No. 2026-097 to establish the reserve as a public highway.",
  );
});

test("stage3 procedural fragment prompts forbid inferred actors and outcomes", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The meeting was called to order.",
              "chapter text": "Meeting called to order",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_call_to_order",
      label: "1 CALL TO ORDER",
      "source excerpt": "Calling the meeting to order. Call for additional business. Just me.",
      "source rows": 3,
      "duration seconds": 8,
      substantive: false,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "The meeting was called to order.");
  assert.match(requestBody.messages[1].content, /announcement such as 'Calling the meeting to order'.*only that the meeting was called to order/iu);
  assert.match(requestBody.messages[1].content, /'Just me'.*not evidence that no business was presented/iu);
  assert.match(requestBody.messages[1].content, /call-to-order announcement/iu);
});

test("stage3 repairs an acting-body label used as a call-to-order speaker", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD ACTING-BODY OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: "The meeting was called to order.",
        "chapter text": "Meeting called to order",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The Operations Committee called its meeting to order."],
          notes: "The source records a speaker calling the meeting to order but does not identify the speaker as the Operations Committee, which is an acting body label rather than a speaker.",
        };
    } else {
      content = {
        summary: "The Operations Committee called its meeting to order.",
        "chapter text": "Operations Committee called to order",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_acting_body",
      label: "1 CALL TO ORDER",
      "source excerpt": "SPEAKER_912: I'll call the meeting of the Operations Committee for June 2025 to order.",
      "source rows": 1,
      "duration seconds": 8,
      substantive: false,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The meeting was called to order.");
  assert.equal(repairCalls, 1);
});

test("stage3 refreshes unsupported institutional presenter attribution", async (t) => {
  let roleRepairCalls = 0;
  let strictRefreshCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD INSTITUTIONAL-ACTOR OUTPUT BAN/iu.test(system)) {
      strictRefreshCalls += 1;
      content = {
        summary: "The source records a recommendation concerning the water management bylaw and states that monthly billing would reduce risk.",
        "chapter text": "Water management recommendation and billing risk",
        confidence: 0.9,
        notes: "",
      };
    } else if (/HARD INSTITUTIONAL-ACTOR OVERRIDE/iu.test(system)) {
      roleRepairCalls += 1;
      content = {
        summary: "The Operations Committee presented the recommendation, and Council noted that monthly billing would reduce risk.",
        "chapter text": "Committee presentation and Council note",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = strictRefreshCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The Operations Committee presented the recommendation."],
          notes: "The source does not state that the committee presented it; a speaker reads the recommendation. It also does not record Council noting the billing fact.",
        };
    } else {
      content = {
        summary: "The Operations Committee presented the recommendation, and Council noted that monthly billing would reduce risk.",
        "chapter text": "Committee presentation and Council note",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_institutional_presenter",
      label: "8.e Water Management Bylaw",
      "source excerpt": "A speaker read: we do have a recommendation before us that the operations committee recommends City Council approve the bylaw. The speaker stated that migration to monthly billing would reduce risk.",
      "source rows": 4,
      "duration seconds": 40,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /source records a recommendation/iu);
  assert.doesNotMatch(result.summary, /Operations Committee presented|Council noted/iu);
  assert.equal(roleRepairCalls, 1);
  assert.equal(strictRefreshCalls, 1);
});

test("stage3 routes institutional discussion compression through role repair", async (t) => {
  let roleRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD INSTITUTIONAL-ACTOR OVERRIDE/iu.test(system)) {
      roleRepairCalls += 1;
      content = {
        summary: "The source records discussion of the Social Pinpoint digital engagement platform and its community-input tools.",
        "chapter text": "Social Pinpoint engagement platform",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = roleRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The candidate claims 'Council discussed' the Social Pinpoint digital engagement platform."],
          notes: "The source records a handoff and staff remarks, but no explicit institutional discussion by Council; staff noted benefits is also unsupported as an institutional compression.",
        };
    } else {
      content = {
        summary: "Council discussed the Social Pinpoint digital engagement platform.",
        "chapter text": "Council discusses Social Pinpoint",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_institutional_discussion",
      label: "3.a 2026 Draft Budget Documents",
      "source excerpt": "A speaker handed the discussion to a staff presenter, who described the Social Pinpoint platform and its community-input tools.",
      "source rows": 4,
      "duration seconds": 40,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(roleRepairCalls, 1);
  assert.match(result.summary, /source records discussion of the Social Pinpoint/iu);
  assert.doesNotMatch(result.summary, /Council discussed|staff noted/iu);
});

test("stage3 preserves referred-back agenda chronology", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD REFERRED-(?:AGENDA-SCOPE|AND-TEMPORAL-SCOPE) OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: "The source records items referred back from the prior Budget and Finance Committee for discussion at the current meeting.",
        "chapter text": "Items referred back for current-meeting discussion",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The candidate incorrectly treats Social Pinpoint as a new current agenda item."],
          notes: "The source says the matter was referred back from a previous meeting for discussion, not as a new current motion or decision.",
        };
    } else {
      content = {
        summary: "The current committee discussed a new Social Pinpoint agenda item.",
        "chapter text": "New Social Pinpoint agenda item",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_referred_back_item",
      label: "3.a Budget and Finance Committee referrals",
      "source excerpt": "The Social Pinpoint matter was referred back from the previous meeting for discussion at today's meeting.",
      "source rows": 2,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(repairCalls, 1);
  assert.match(result.summary, /referred back from the prior Budget and Finance Committee/iu);
  assert.doesNotMatch(result.summary, /new .*agenda item|approved/iu);
});

test("stage3 preserves distinct morning and prior-phase chronology", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD REFERRED-AND-TEMPORAL-SCOPE OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: "The source distinguishes a morning overview from budget-reduction options discussed over lunch or mentioned at a previous committee meeting.",
        "chapter text": "Distinct morning and prior-phase budget context",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The candidate says budget-reduction options were discussed in the current morning session."],
          notes: "The source distinguishes options discussed over the lunch period or mentioned at a previous committee meeting from the current morning session; the candidate collapses those phases.",
        };
    } else {
      content = {
        summary: "A recap of budget reduction options discussed in the morning session was provided.",
        "chapter text": "Morning budget-reduction options",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_temporal_phase_scope",
      label: "3.a Budget reduction overview",
      "source excerpt": "The CEO would provide an overview of generalities from this morning and staff recommendations to look at further budget-reduction opportunities. Some options were discussed over the lunch period or mentioned at a previous committee meeting.",
      "source rows": 3,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(repairCalls, 1);
  assert.match(result.summary, /distinguishes a morning overview/iu);
  assert.match(result.summary, /over lunch|previous committee meeting/iu);
  assert.doesNotMatch(result.summary, /options discussed in the morning session/iu);
});

test("stage3 keeps a recommendation separate from a nearby merit phrase", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD SOURCE-TOPIC-RELATIONSHIP OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: repairCalls === 1
          ? "The source records a recommendation to explore a regional platform."
          : "The source records the matter as a recommendation and separately discusses the merit of exploring a regional platform.",
        "chapter text": repairCalls === 1
          ? "Recommendation to explore platform"
          : "Recommendation and separate exploration merit",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The candidate claims a recommendation to explore a regional platform."],
          notes: "The source says the matter was brought forward as a recommendation and separately discusses merit to explore; the action and nearby phrase are not explicitly paired.",
        };
    } else {
      content = {
        summary: "The source records a recommendation to explore a regional platform.",
        "chapter text": "Recommendation to explore platform",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_recommendation_relationship",
      label: "3.a Regional social engagement platform",
      "source excerpt": "Staff brought the matter forward as a recommendation. The source also records that there is merit to explore a consistent regional platform and message.",
      "source rows": 2,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(repairCalls, 2);
  assert.match(result.summary, /recommendation and separately discusses/iu);
  assert.doesNotMatch(result.summary, /recommendation to explore/iu);
});

test("stage3 repairs a plural generic actor when one source speaker owns the claim", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD GENERIC-PLURAL-ACTOR OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: "A speaker discussed the shop rate proposal.",
        "chapter text": "Speaker discusses shop rate proposal",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The candidate uses a generic plural 'Speakers' for a claim paired with one source speaker."],
          notes: "The source attributes the claim to one speaker; the generic plural is unsupported.",
        };
    } else if (/The prior audit is only an allegation/iu.test(prompt) || /Ignore all prior audit allegations/iu.test(prompt)) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The candidate uses a generic plural 'Speakers' for a claim paired with one source speaker."],
          notes: "The source attributes the claim to one speaker; the generic plural is unsupported.",
        };
    } else {
      content = {
        summary: "Speakers discussed the shop rate proposal.",
        "chapter text": "Speakers discuss shop rate proposal",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_generic_plural_actor",
      label: "4.b Fleet maintenance",
      "source excerpt": "Director Scott Greig said the proposal would increase the shop rate.",
      "source rows": 1,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(repairCalls, 1);
  assert.match(result.summary, /A speaker discussed the shop rate proposal/iu);
  assert.doesNotMatch(result.summary, /Speakers/iu);
});

test("stage3 removes an unsupported descriptive qualifier without dropping the supported topic", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD UNSUPPORTED-QUALIFIER OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: "A presentation described the budget book structure.",
        "chapter text": "Presentation describes budget book structure",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The qualifier 'new' is not explicitly supported by the source."],
          notes: "The source describes the budget book structure but does not call it new or digital.",
        };
    } else if (/The prior audit is only an allegation/iu.test(prompt) || /Ignore all prior audit allegations/iu.test(prompt)) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The qualifier 'new' is not explicitly supported by the source."],
          notes: "The source describes the budget book structure but does not call it new or digital.",
        };
    } else {
      content = {
        summary: "A presentation regarding a new digital budget book format was provided.",
        "chapter text": "Presentation covers new digital budget book",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_unsupported_qualifier",
      label: "3.a Budget book",
      "source excerpt": "A presentation described the budget book structure, with narrative followed by financials.",
      "source rows": 1,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(repairCalls, 1);
  assert.match(result.summary, /presentation described the budget book structure/iu);
  assert.doesNotMatch(result.summary, /new digital/iu);
});

test("stage3 routes parent institutional-role defects through parent overview repair", async (t) => {
  let parentRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (/Conservative parent-overview grounding repair/iu.test(prompt)) {
      parentRepairCalls += 1;
      content = {
        summary: "The source records a recommendation about the water management bylaw and discussion of billing risk.",
        "chapter text": "Water management recommendation and billing risk",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = parentRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The Operations Committee presented the recommendation."],
          notes: "The source does not state that the committee presented it; a speaker reads the recommendation. Council noting the billing fact is also unsupported.",
        };
    } else {
      content = {
        summary: "The Operations Committee presented the recommendation, and Council noted the billing risk.",
        "chapter text": "Committee presentation and Council note",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_parent_institutional_role",
      label: "8.e Water Management Bylaw",
      "source excerpt": "AUDITED CHILD SUMMARY: The Operations Committee presented the recommendation, and Council noted the billing risk.",
      "parent overview": true,
      "parent literal source excerpt": "LITERAL SOURCE ANCHOR: A speaker read a recommendation and stated that monthly billing would reduce risk.",
      "source rows": 4,
      "duration seconds": 40,
      substantive: true,
      "child chapters": [],
    },
    focus: "clear civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /source records a recommendation/iu);
  assert.equal(parentRepairCalls, 1);
});

test("stage3 uses a conservative LLM repair for minutes-only handoffs", async (t) => {
  let calls = 0;
  let conservativePrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = calls >= 5
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["reported back"], notes: "The source only records a handoff." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["reported back"], notes: "The source only records a handoff." };
    } else if (prompt.includes("Conservative minutes-handoff repair")) {
      conservativePrompt = prompt;
      content = {
        summary: "The discussion returned to the minutes for the next part.",
        "chapter text": "Discussion returned to minutes",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary")) {
      content = { grounded: false, "unsupported claims": ["reported back"], notes: "The source only records a handoff." };
    } else {
      content = {
        summary: "The July 9, 2024 minutes were handed back to the mayor.",
        "chapter text": "Minutes handed back",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_minutes_handoff",
      label: "12.b Minutes of the Service Review Implementation Ad Hoc Committee meeting held on July 9, 2025",
      "source excerpt": "I will pass it back to you for part two of that meeting for the minutes. So back to you.",
      "source rows": 3,
      "duration seconds": 25,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The discussion returned to the minutes for the next part.");
  assert.match(conservativePrompt, /do not name a recipient/iu);
  assert.match(conservativePrompt, /omit dates and handoff qualifiers such as part numbers/iu);
  assert.match(conservativePrompt, /The excerpt records a handoff to the Service Review minutes.*without recording their presentation or approval/iu);
  assert.match(conservativePrompt, /do not use return, back, pass, or hand verbs/iu);
  assert.match(conservativePrompt, /Do not use the words reported, reported back, presented/iu);
  assert.match(conservativePrompt, /Hard constraint for a handoff-only span.*do not copy any date/iu);
});

test("stage3 keeps a generic minutes motion separate from a later minutes item", async (t) => {
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative minutes-motion-scope repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The excerpt records a handoff to the Corporate Services Committee minutes without explicitly recording their presentation or approval.",
        "chapter text": "Handoff to Corporate Services minutes",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["received the Corporate Services minutes"], notes: "The later receipt concerns another committee's minutes." };
    } else {
      content = {
        summary: "The meeting received the Corporate Services Committee minutes.",
        "chapter text": "Corporate Services minutes received",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_minutes_motion_scope",
      label: "12.d Minutes of the Corporate Services Committee meeting held on July 10, 2025",
      "source excerpt": "Back to you for the minutes of the Corporate Services Committee. I'll move the minutes. All in favour? That's carried. Community Services, these are the minutes of July 16th. I move receipt of the Community Services minutes.",
      "source rows": 6,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The excerpt records a handoff to the Corporate Services Committee minutes without explicitly recording their presentation or approval.");
  assert.match(repairPrompt, /later named committee.*omit its content/iu);
  assert.match(repairPrompt, /generic motion.*ambiguous.*handoff-only/iu);
});

test("stage3 uses a conservative LLM repair for consent-agenda ranges", async (t) => {
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative consent-agenda-scope repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The carried consent-agenda motion received items 11A to 11O, except 11A, 11E, and 11J, and approved the recommendations in items 11A to 11J, except 11A, 11E, and 11J.",
        "chapter text": "Consent agenda ranges and exceptions",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["approval range narrowed incorrectly"], notes: "The source has separate receive and approval ranges." };
    } else {
      content = {
        summary: "The Council approved items 11A to 11J on the consent agenda.",
        "chapter text": "Consent agenda approved",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_consent_scope",
      label: "11 CONSENT AGENDA",
      role: "other",
      status: "container",
      "source excerpt": "On the consent agenda, Council receives items 11A to 11O, save and accept 11A, 11E, and 11J, and approves the recommendations contained in items 11A to 11J, save and accept 11A, 11E, and 11J. All in favour? That's carried. Item 11A is then discussed separately.",
      "source rows": 4,
      "duration seconds": 60,
      substantive: false,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The carried consent-agenda motion received items 11A to 11O, except 11A, 11E, and 11J, and approved the recommendations in items 11A to 11J, except 11A, 11E, and 11J.");
  assert.match(repairPrompt, /exact source ranges and exceptions/iu);
  assert.match(repairPrompt, /do not use a later pulled item's motion/iu);
});

test("stage3 uses a conservative LLM repair for short procedural fragments", async (t) => {
  let calls = 0;
  let conservativePrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = calls >= 5
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["addressed the call"], notes: "The source is fragmentary." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["addressed the call"], notes: "The source is fragmentary." };
    } else if (prompt.includes("Conservative procedural-fragment repair")) {
      conservativePrompt = prompt;
      content = {
        summary: "The transcript records a call to order and a call for additional business, followed by the response 'Just me.'",
        "chapter text": "Call to order and additional business",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary")) {
      content = { grounded: false, "unsupported claims": ["addressed the call"], notes: "The source is fragmentary." };
    } else {
      content = {
        summary: "A speaker called the meeting to order and addressed the call for additional business.",
        "chapter text": "Meeting opening",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_procedural_fragment",
      label: "1 CALL TO ORDER",
      "source excerpt": "Calling the meeting to order. Call for additional business. Just me.",
      "source rows": 3,
      "duration seconds": 8,
      substantive: false,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /call to order.*additional business.*Just me/iu);
  assert.match(conservativePrompt, /Do not name a speaker or governing body/iu);
  assert.match(conservativePrompt, /do not expand a terse response such as 'Just me'/iu);
  assert.match(conservativePrompt, /isolated reply such as 'Thank you\.'/iu);
  assert.match(conservativePrompt, /bare title or address token such as 'Worship\.'/iu);
  assert.match(conservativePrompt, /INDEPENDENT_AUDIT_REJECTION/iu);
  assert.match(conservativePrompt, /REJECTED_CANDIDATE/iu);
});

test("stage3 keeps specialized procedural repair after speaker metadata cleanup", async (t) => {
  let calls = 0;
  let metadataPrompt = "";
  let fragmentRepairCalls = 0;
  let fragmentRepaired = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Speaker-metadata retry")) {
      metadataPrompt = prompt;
      content = {
        summary: "The transcript records a call to order and a request for additional business.",
        "chapter text": "Meeting opening announcements",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Conservative procedural-fragment repair")) {
      fragmentRepairCalls += 1;
      fragmentRepaired = true;
      content = {
        summary: "The transcript records Speaker_052 calling the meeting to order.",
        "chapter text": "Meeting opening announcement",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = fragmentRepaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["unsupported actor"], notes: "The source is fragmentary." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["unsupported actor"], notes: "The source is fragmentary." };
    } else if (system.includes("Audit one generated civic summary")) {
      content = { grounded: false, "unsupported claims": ["unsupported actor"], notes: "The source is fragmentary." };
    } else {
      content = {
        summary: "A council member called the meeting to order.",
        "chapter text": "Meeting opening",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_procedural_speaker_repair",
      label: "1 CALL TO ORDER",
      "source excerpt": "SPEAKER_052: Calling the meeting to order.\nSPEAKER_052: Call for additional business.",
      "source rows": 2,
      "duration seconds": 3,
      substantive: false,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The transcript records a call to order and a request for additional business.");
  assert.equal(fragmentRepairCalls, 1);
  assert.match(metadataPrompt, /remove every token matching SPEAKER_/iu);
  assert.doesNotMatch(result.summary, /SPEAKER_/u);
  assert.ok(calls >= 5);
});

test("stage3 uses a conservative LLM repair for separate amendment outcomes", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (system.includes("Extract literal amendment layers")) {
      content = {
        "document amendment": "Council approves an amendment to the Board and Committee Bylaw",
        "motion amendment": "not accepted",
        "original motion disposition": "carried",
        "later action": "Councillor Koepke was nominated by acclamation",
        evidence: ["the motion on the screen was carried"],
      };
    } else if (prompt.includes("Conservative amendment-sequence repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The motion to amend the Board and Committee Bylaw and appoint another council member carried, while the proposed amendment to the motion was not accepted. Councillor Koepke was later nominated to the Police Services Board by acclamation.",
        "chapter text": "Bylaw motion and later board nomination",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["merged amendment outcomes"], notes: "The source has separate amendment layers." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["merged amendment outcomes"], notes: "The source has separate amendment layers." };
    } else if (system.includes("Audit one generated civic summary")) {
      content = { grounded: false, "unsupported claims": ["merged amendment outcomes"], notes: "The source has separate amendment layers." };
    } else {
      content = {
        summary: "Council approved the amendment and nominated Councillor Koepke by acclamation.",
        "chapter text": "Amendment and nomination approved",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_amendment_sequence",
      label: "14.a Police Services Board Appointment",
      role: "procedural",
      "source excerpt": "The motion says Council approves an amendment to the Board and Committee Bylaw and appoints another member. A proposed amendment to the motion was not accepted. There was no amendment made to the motion, and the motion on the screen was carried. Councillor Koepke was later nominated by acclamation.",
      "source rows": 5,
      "duration seconds": 120,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /Board and Committee Bylaw/iu);
  assert.match(result.summary, /proposed amendment.*not accepted/iu);
  assert.match(result.summary, /Koepke.*acclamation/iu);
  assert.match(repairPrompt, /keep the layers separate/iu);
  assert.match(repairPrompt, /STRUCTURED AMENDMENT EVIDENCE/iu);
  assert.match(repairPrompt, /document amendment/iu);
  assert.match(repairPrompt, /later nomination.*separate action/iu);
  assert.ok(calls >= 5);
});

test("stage3 treats a standalone speaker callout as a handoff", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (system.includes("Extract literal speaker-block handoffs")) {
      content = {
        handoff: true,
        "preceding speaker": "SPEAKER_915",
        "standalone callout": "Councillor Lee.",
        "following speaker": "SPEAKER_053",
        evidence: ["Councillor Lee."],
      };
    } else if (prompt.includes("Conservative speaker-handoff repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "Council considered the public's opportunity to review next steps before a later procedural motion.",
        "chapter text": "Council considered public review opportunities",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Source-grounding repair attempt")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "Council considered the public's opportunity to review next steps before a later procedural motion.",
        "chapter text": "Council considered public review opportunities",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["speaker attribution"], notes: "The standalone callout is a handoff." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["speaker attribution"], notes: "The standalone callout is a handoff." };
    } else if (prompt.includes("Ignore all prior audit allegations")) {
      content = { grounded: false, "unsupported claims": ["speaker attribution"], notes: "The standalone callout is a handoff." };
    } else {
      content = {
        summary: "Councillor Lee questioned whether the public had a fair chance to review next steps.",
        "chapter text": "Public review question before next steps",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_speaker_handoff",
      label: "11.a Report on a road allowance request",
      role: "staff_report",
      "source excerpt": "SPEAKER_915: The public had a fair chance to review the next steps.\nSPEAKER_915: Councillor Lee.\nSPEAKER_053: Stop-up procedures usually require a request.\nSPEAKER_008: I move that Council defer the item.",
      "source rows": 4,
      "duration seconds": 120,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "Council considered the public's opportunity to review next steps before a later procedural motion.");
  assert.match(repairPrompt, /STRUCTURED SPEAKER-HANDOFF EVIDENCE/iu);
  assert.match(repairPrompt, /do not attribute any preceding block's question/iu);
  assert.match(repairPrompt, /When the audit says the bounded source ends before a motion, vote, deferral, or conclusion/iu);
  assert.match(repairPrompt, /ACTOR-AUDIT FINAL OVERRIDE/iu);
  assert.doesNotMatch(result.summary, /Councillor Lee/iu);
  assert.ok(calls >= 7);
});

test("stage3 keeps a report introducer separate from the named report subject", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative report-introduction attribution repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The excerpt described committee reports and recommendations, followed by a fleet-management report and a carried procurement motion.",
        "chapter text": "Fleet report and procurement motion",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["report presenter"], notes: "The introducer is not the named report subject." };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = { grounded: false, "unsupported claims": ["report presenter"], notes: "The introducer is not the named report subject." };
    } else {
      content = {
        summary: "Mr. Nichol introduced his report on fleet management, and a member moved to approve the minutes.",
        "chapter text": "Named presenter introduced fleet report",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_report_introduction",
      "agenda item": "12.a",
      label: "12.a Minutes of the Service Review Implementation Ad Hoc Committee meeting",
      role: "other",
      "source excerpt": "SPEAKER_052: We received a report from the Fire Services Administrator, being Mr. Nichol, regarding the fleet strategy update.\nSPEAKER_915: I move to approve the minutes.\nSPEAKER_115: This is a report from Mr. Nichol regarding fleet management.\nSPEAKER_2983: The report recommends a fleet-management program.\nSPEAKER_601: The motion carried.",
      "source rows": 5,
      "duration seconds": 120,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The excerpt described committee reports and recommendations, followed by a fleet-management report and a carried procurement motion.");
  assert.match(repairPrompt, /report-introduction attribution/iu);
  assert.match(repairPrompt, /keep the introducer and the named report subject separate/iu);
  assert.match(repairPrompt, /report from \[person\].*not.*proof that the named person introduced or presented/iu);
  assert.match(repairPrompt, /historical minutes report.*current report.*separate clauses/iu);
  assert.doesNotMatch(result.summary, /introduced his report/iu);
  assert.ok(calls >= 6);
});

test("stage3 report-proposal repairs do not seed rejected report-description wording", async (t) => {
  let repairPrompt = "";
  let repaired = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative report-proposal repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "Staff discussed a proposed digital-engagement process and a later motion concerning its budget treatment.",
        "chapter text": "Digital engagement process and budget motion",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["report description"], notes: "The source does not use that framing." };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = { grounded: false, "unsupported claims": ["report description"], notes: "The source does not use that framing." };
    } else {
      content = {
        summary: "The report description included a proposed process.",
        "chapter text": "Report description and proposed process",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_report_proposal_prompt",
      label: "3.a Digital engagement budget report",
      role: "staff_report",
      "source excerpt": "Staff described a proposed digital-engagement process. A motion concerning the budget was defeated.",
      "source rows": 2,
      "duration seconds": 90,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /Staff discussed a proposed digital-engagement process/iu);
  assert.match(repairPrompt, /literal source supports that exact report or item identity/iu);
  assert.doesNotMatch(repairPrompt, /The report description included a proposed process/iu);
});

test("stage3 preserves additional-business remarks as remarks", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative additional-business repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "Council discussed congratulations for a retiring community broadcaster and thanked an acting deputy clerk who is leaving.",
        "chapter text": "Council discussed additional-business remarks",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["formal proposed matters"], notes: "The source records remarks, not motions." };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = { grounded: false, "unsupported claims": ["formal proposed matters"], notes: "The source records remarks, not motions." };
    } else {
      content = {
        summary: "Council proposed two matters for additional business and moved them forward.",
        "chapter text": "Additional business proposals",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_additional_business_remarks",
      label: "15 DISCUSSION OF ADDITIONAL BUSINESS",
      role: "other",
      "source excerpt": "Additional discussion of additional business. I just have two matters. We congratulate a retiring community broadcaster and thank an acting deputy clerk who is leaving. Do you want to give a speech? That laughter seemed to be a no.",
      "source rows": 5,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "Council discussed congratulations for a retiring community broadcaster and thanked an acting deputy clerk who is leaving.");
  assert.match(repairPrompt, /I have two matters.*remarks or topics, not formal proposals or motions/iu);
  assert.doesNotMatch(result.summary, /proposed|motion/iu);
  assert.ok(calls >= 6);
});

test("stage3 keeps a terse agenda-position transition neutral", async (t) => {
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative agenda-transition repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The transcript records the meeting moving through item fourteen and reaching item fifteen.",
        "chapter text": "Transition from item fourteen to item fifteen",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["seconded motion"], notes: "The source records only an agenda transition." };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = { grounded: false, "unsupported claims": ["seconded motion"], notes: "The source records only an agenda transition." };
    } else {
      content = {
        summary: "A speaker seconded the motion and another speaker noted the meeting was at item fifteen.",
        "chapter text": "Seconded motion and item fifteen",
        confidence: 0.9,
        notes: "",
      };
    }
    return { ok: true, async json() { return { message: { content: JSON.stringify(content) } }; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_agenda_transition",
      label: "14.a Motion for Which Notice was Previously Given",
      role: "other",
      "source excerpt": "Seconds us through fourteen. We're at fifteen.",
      "source rows": 2,
      "duration seconds": 2,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The transcript records the meeting moving through item fourteen and reaching item fifteen.");
  assert.match(repairPrompt, /terse agenda-position transition/iu);
  assert.match(repairPrompt, /not evidence that a named speaker seconded a motion/iu);
});

test("stage3 preserves first-person procedural tense", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative procedural-self-report repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "The transcript records a speaker stating that a council member will be appointed to the Police Services Board and saying they will pass the gavel back.",
        "chapter text": "Speaker stated future appointment and handoff",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["completed procedural actions"], notes: "The source preserves future and first-person wording." };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = { grounded: false, "unsupported claims": ["completed procedural actions"], notes: "The source preserves future and first-person wording." };
    } else {
      content = {
        summary: "The speaker announced the appointment before passing the gavel back.",
        "chapter text": "Appointment announcement and gavel handoff",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_procedural_self_report",
      label: "14.a procedural handoff",
      role: "procedural",
      "source excerpt": "Councillor Koepke will be appointed as the second member of council to sit on the Police Services Board. And with that, I'll pass the gavel back to Mayor. We're at fifteen.",
      "source rows": 3,
      "duration seconds": 15,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The transcript records a speaker stating that a council member will be appointed to the Police Services Board and saying they will pass the gavel back.");
  assert.match(repairPrompt, /preserve future or intended wording as future or intended/iu);
  assert.match(repairPrompt, /do not use 'announced'.*'passed'/iu);
  assert.ok(calls >= 6);
});

test("stage3 uses a conservative LLM repair for explicit absence listings", async (t) => {
  let calls = 0;
  let repaired = false;
  let repairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative absence-listing repair")) {
      repaired = true;
      repairPrompt = prompt;
      content = {
        summary: "No correspondence was reported for the item.",
        "chapter text": "No correspondence reported",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["unspecified speaker attribution"], notes: "The source is an absence listing." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["unspecified speaker attribution"], notes: "The source is an absence listing." };
    } else if (system.includes("Audit one generated civic summary")) {
      content = { grounded: false, "unsupported claims": ["unspecified speaker attribution"], notes: "The source is an absence listing." };
    } else {
      content = {
        summary: "The speaker stated that there was no correspondence for item nine.",
        "chapter text": "No correspondence for item nine",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_absence_listing",
      label: "9 CORRESPONDENCE RECEIVED FOR WHICH DIRECTION OF COUNCIL IS REQUIRED",
      role: "correspondence",
      "source excerpt": "SPEAKER_115: Number 9, we have no correspondence.\nSPEAKER_115: At number ten, reports from city staff.",
      "source rows": 2,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "No correspondence was reported for the item.");
  assert.match(repairPrompt, /do not write 'the speaker stated'/iu);
  assert.match(repairPrompt, /import any later report/iu);
  assert.ok(calls >= 5);
});

test("stage3 keeps a no-public-meetings listing as an absence", async (t) => {
  let repaired = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Conservative absence-listing repair")) {
      repaired = true;
      content = {
        summary: "No public meetings were listed for the item.",
        "chapter text": "No public meetings listed",
        confidence: 0.9,
        notes: "",
      };
    } else if (system.includes("Audit one generated civic summary")) {
      content = repaired
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["addressed public meetings"], notes: "The source states that there were no public meetings." };
    } else {
      content = {
        summary: "The item addressed public meetings.",
        "chapter text": "Public meetings addressed",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_no_public_meetings",
      label: "6 PUBLIC MEETINGS",
      role: "procedural",
      "source excerpt": "So, in committee of the whole, at number six, we have no public meetings. At number seven, we have a deputation from the City Manager.",
      "source rows": 2,
      "duration seconds": 12,
      substantive: false,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "No public meetings were listed for the item.");
});

test("stage3 rejects neighboring-item contamination through an independent source audit", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    let content;
    if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = calls === 2
        ? { grounded: false, "unsupported claims": ["water meter update"], notes: "That topic is absent from this source excerpt." }
        : { grounded: true, "unsupported claims": [], notes: "" };
    } else if (prompt.includes("Source-grounding repair")) {
      content = { summary: "The committee discussed outdoor advertising.", "chapter text": "Outdoor advertising discussion", confidence: 0.9, notes: "" };
    } else {
      content = { summary: "The committee received a water meter update.", "chapter text": "Water meter update", confidence: 0.9, notes: "" };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_contamination",
      label: "8.b Outdoor Advertising",
      "source excerpt": "The committee discussed the city's outdoor advertising agreement.",
      "source rows": 2,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The committee discussed outdoor advertising.");
  assert.equal(calls, 6);
  assert.deepEqual(
    await auditGroundedSummaryLlm({
      label: "8.b Outdoor Advertising",
      summary: result.summary,
      sourceExcerpt: "The committee discussed the city's outdoor advertising agreement.",
      llmModel: "qwen3.5:9b",
      ollamaUrl: "http://ollama.invalid/api/chat",
    }),
    { grounded: true, unsupportedClaims: [], notes: "" },
  );
  assert.equal(calls, 7);
});

test("stage3 varies repeated grounding repairs and switches to fresh source-only prose", async (t) => {
  let calls = 0;
  let repairCalls = 0;
  const repairPrompts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = {
        verdict: "PASS",
        claim_type: "none",
        source_support: "none",
        needs_attribution: false,
        needs_category_qualifier: false,
        feedback: "No financial claim is present.",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      const grounded = repairCalls >= 3;
      content = grounded
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["passive scheduling wording"], notes: "The source records an immediate procedural adjustment." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["passive scheduling wording"], notes: "The rejection remains unresolved." };
    } else if (prompt.includes("Source-grounding repair")) {
      repairCalls += 1;
      repairPrompts.push(prompt);
      const summary = repairCalls >= 3
        ? "The minutes were presented immediately after the report because of time constraints and procedural order."
        : "The minutes were scheduled for presentation following procedural direction.";
      content = { summary, "chapter text": "Procedural adjustment", confidence: 0.9, notes: "" };
    } else {
      content = {
        summary: "The minutes were scheduled for presentation following procedural direction.",
        "chapter text": "Procedural adjustment",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_repeated_grounding",
      label: "10 REPORTS OF CITY STAFF",
      "source excerpt": "The report was presented immediately because of time constraints and the minutes' procedural order.",
      "source rows": 3,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The minutes were presented immediately after the report because of time constraints and procedural order.");
  assert.equal(repairCalls, 3);
  assert.equal(repairPrompts.length, 3);
  assert.match(repairPrompts[0], /REJECTION_REASON:/u);
  assert.match(repairPrompts[0], /multiple materially different procedural dispositions/iu);
  assert.match(repairPrompts[0], /PRIOR_REJECTED_OUTPUT:/u);
  assert.match(repairPrompts[1], /PRIOR_REJECTED_OUTPUT:/u);
  assert.notEqual(repairPrompts[0], repairPrompts[1]);
  assert.doesNotMatch(repairPrompts[2], /PRIOR_REJECTED_OUTPUT:/u);
  assert.match(repairPrompts[2], /fresh source-grounded prose/iu);
  assert.match(repairPrompts[0], /Keep a motion's source-supported action and disposition separate from background context/iu);
  assert.match(repairPrompts[0], /Do not turn contextual participants or process details into the mechanism of the vote/iu);
  assert.equal(calls, 14);
});

test("stage3 routes inflected numeric grounding conflicts to qualitative repair", async (t) => {
  let qualitativeRepairCalls = 0;
  const qualitativeRepairPrompts = [];
  let genericRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/omits contradictory numeric or date detail/iu.test(system)) {
      qualitativeRepairCalls += 1;
      qualitativeRepairPrompts.push(prompt);
      content = {
        summary: "The committee discussed the staff report and the proposed service change.",
        "chapter text": "Staff report and proposed service change",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = qualitativeRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The reported amount is contradicted by the source."],
          notes: "The candidate financial amount is contradicted by conflicting source dates and amounts.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = {
        grounded: false,
        "unsupported claims": ["The reported amount is contradicted by the source."],
        notes: "The candidate financial amount is contradicted by conflicting source dates and amounts.",
      };
    } else if (prompt.includes("Source-grounding repair")) {
      genericRepairCalls += 1;
      content = {
        summary: "The report covered January to May 2025 and the platform cost $30,000 annually.",
        "chapter text": "Report and platform cost",
        confidence: 0.9,
        notes: "",
      };
    } else {
      content = {
        summary: "The report covered January to May 2025 and the platform cost $30,000 annually.",
        "chapter text": "Report and platform cost",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_inflected_numeric_conflict",
      label: "8.a Transit Dashboard",
      "source excerpt": "The report runs from January 1st to May 31st, 2025. The platform cost was thirty thousand dollars, with a separate annual rate closer to twenty-five thousand.",
      "source rows": 4,
      "duration seconds": 90,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The committee discussed the staff report and the proposed service change.");
  assert.equal(qualitativeRepairCalls, 1);
  assert.equal(genericRepairCalls, 0);
  assert.match(qualitativeRepairPrompts[0], /GROUNDED_SOURCE_WITH_NUMERIC_DETAIL_MASKED:/iu);
  assert.doesNotMatch(qualitativeRepairPrompts[0], /2025|thirty thousand|twenty-five/iu);
});

test("stage3 retries a numeric-neutral repair that broadens a source scope", async (t) => {
  let qualitativeRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/omits contradictory numeric or date detail/iu.test(system)) {
      qualitativeRepairCalls += 1;
      content = {
        summary: qualitativeRepairCalls === 1
          ? "The motion adjusted specific departments."
          : "A motion to adjust a budget was moved.",
        "chapter text": "Budget motion",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = qualitativeRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The motion scope is not supported."],
          notes: "The candidate amount conflicts with the source amount and the date is mismatched.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = {
        grounded: false,
        "unsupported claims": ["The motion scope is not supported."],
        notes: "The candidate amount conflicts with the source amount and the date is mismatched.",
      };
    } else {
      content = {
        summary: "The motion adjusted the 2026 budgets for specific departments.",
        "chapter text": "Budget motion",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_numeric_scope_retry",
      label: "8.b Budget motion",
      "source excerpt": "The source records a motion to adjust the 2026 and 2027 budgets for the Paramedics Services Department.",
      "source rows": 2,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "A motion to adjust a budget was moved.");
  assert.equal(qualitativeRepairCalls, 2);
});

test("stage3 keeps future expectations separate from later generic carried phrases", async (t) => {
  let speechActRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/separates a formal motion from procedural or debate context/iu.test(system)) {
      speechActRepairCalls += 1;
      content = {
        summary: "The source records an expectation that the next report would set out the methodology and standard.",
        "chapter text": "Next report methodology expectation",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = speechActRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A speaker recommended setting out the methodology."],
          notes: "The source records an expectation for the next report rather than a formal recommendation or motion; the later generic carried phrase has no paired subject.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = {
        grounded: false,
        "unsupported claims": ["A speaker recommended setting out the methodology."],
        notes: "The source records an expectation for the next report rather than a formal recommendation or motion; the later generic carried phrase has no paired subject.",
      };
    } else {
      content = {
        summary: "A speaker recommended setting out the methodology, and the motion carried.",
        "chapter text": "Methodology recommendation carried",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_future_expectation",
      label: "8.c Roads Condition Update",
      "source excerpt": "I would expect as part of the next report that it would set out what the methodology and standard being applied is. All those in favour of the motion, and that's carried unanimously.",
      "source rows": 3,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The source records an expectation that the next report would set out the methodology and standard.");
  assert.equal(speechActRepairCalls, 1);
});

test("stage3 keeps tentative mover discussion separate from a completed motion", async (t) => {
  let speechActRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD TENTATIVE-MOTION OVERRIDE/iu.test(system)) {
      speechActRepairCalls += 1;
      content = {
        summary: "The source records a recommendation for City Council consideration and tentative floor discussion, without recording a disposition.",
        "chapter text": "Recommendation and tentative floor discussion",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = speechActRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A recommendation was moved and carried."],
          notes: "The source does not record a motion being moved; it only records the question 'Do I have a mover of the recommendation?' followed by a statement that a councillor will move it, and the transcript ends immediately after that statement.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = {
        grounded: false,
        "unsupported claims": ["A recommendation was moved and carried."],
        notes: "The source does not record a motion being moved; it only records the question 'Do I have a mover of the recommendation?' followed by a statement that a councillor will move it, and the transcript ends immediately after that statement.",
      };
    } else {
      content = {
        summary: "A recommendation was moved and carried.",
        "chapter text": "Recommendation moved and carried",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_tentative_motion",
      label: "8.d Water management bylaw",
      "source excerpt": "The operations committee recommends City Council approve the bylaw. Do I have a mover of the recommendation? Councillor Kukreja thinks she will move it. Okay. So, it is on the floor. The excerpt ends before any disposition.",
      "source rows": 5,
      "duration seconds": 50,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The source records a recommendation for City Council consideration and tentative floor discussion, without recording a disposition.");
  assert.equal(speechActRepairCalls, 1);
});

test("stage3 refreshes tentative-motion prose when a repair repeats a completed verb", async (t) => {
  let conservativeRepairCalls = 0;
  let strictRefreshCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD TENTATIVE-PROCEDURE OUTPUT BAN/iu.test(system)) {
      strictRefreshCalls += 1;
      content = {
        summary: "The source records a recommendation for consideration and tentative floor discussion without recording a disposition.",
        "chapter text": "Recommendation and tentative floor discussion",
        confidence: 0.9,
        notes: "",
      };
    } else if (/HARD TENTATIVE-MOTION OVERRIDE/iu.test(system)) {
      conservativeRepairCalls += 1;
      content = {
        summary: "The recommendation was moved for consideration.",
        "chapter text": "Recommendation moved",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = strictRefreshCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The recommendation was moved."],
          notes: "The source asks for a mover and ends before recording a formal motion or disposition.",
        };
    } else {
      content = {
        summary: "The recommendation was moved and carried.",
        "chapter text": "Recommendation moved and carried",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_tentative_motion_refresh",
      label: "8.d Water management bylaw",
      "source excerpt": "Do I have a mover of the recommendation? A councillor says she will move it. The excerpt ends before any formal motion or disposition.",
      "source rows": 3,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /tentative floor discussion/iu);
  assert.equal(conservativeRepairCalls, 1);
  assert.equal(strictRefreshCalls, 1);
});

test("stage3 removes proposed-motion wording when the source says the motion was not on the floor", async (t) => {
  let strictRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD TENTATIVE-PROCEDURE OUTPUT BAN/iu.test(system)) {
      strictRepairCalls += 1;
      content = {
        summary: "The source records discussion of a possible 2027 budget option if the item is removed from the 2026 budget, without a formal motion or disposition.",
        "chapter text": "Discussion of a possible 2027 budget option",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = strictRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A motion was proposed."],
          notes: "The source describes what a motion not on the floor would do and does not record a formal motion being proposed, moved, or seconded.",
        };
    } else {
      content = {
        summary: "A motion was proposed to allow the committee to continue discussions in 2027.",
        "chapter text": "Proposed 2027 budget motion",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_motion_not_on_floor",
      label: "8.e 2027 budget discussion",
      "source excerpt": "The speaker described what the motion not on the floor would do: allow the Joint Municipal Services Committee to continue discussions in 2027 if Council removes the item from the 2026 budget. The excerpt does not record a formal motion.",
      "source rows": 3,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /possible 2027 budget option/iu);
  assert.doesNotMatch(result.summary, /motion was proposed/iu);
  assert.equal(strictRepairCalls, 1);
});

test("stage3 repairs invented discussion before an immediately carried motion", async (t) => {
  let floorRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/Procedural-floor repair attempt|Procedural-floor attribution repair attempt/iu.test(prompt)) {
      floorRepairCalls += 1;
      content = {
        summary: "The recommendation was moved and carried unanimously.",
        "chapter text": "Recommendation carried",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = floorRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The floor was opened for consideration before the vote."],
          notes: "Discussion proceeded before the call for votes, but the source only records a no-further-questions transition before the recommendation was carried.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = floorRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The floor was opened for consideration before the vote."],
          notes: "Discussion proceeded before the call for votes, but the source only records a no-further-questions transition before the recommendation was carried.",
        };
    } else {
      content = {
        summary: "Discussion proceeded regarding the recommendation before concluding with a call for votes.",
        "chapter text": "Discussion before vote",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_floor_sequence",
      label: "8.e Water management bylaw",
      "source excerpt": "The recommendation was moved. Any further questions? Seeing none. All those in favour? That is carried unanimously.",
      "source rows": 4,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The recommendation was moved and carried unanimously.");
  assert.ok(floorRepairCalls >= 1);
});

test("stage3 uses a fresh source-only repair for an unsupported second", async (t) => {
  let sourceOnlyRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD OPTIONAL-PROCEDURE-DETAIL OVERRIDE/iu.test(system)) {
      sourceOnlyRepairCalls += 1;
      content = {
        summary: "Councillor Kukreja moved the recommendations except recommendation seven, and the motion carried.",
        "chapter text": "Recommendations except seven carried",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = sourceOnlyRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The motion was seconded."],
          notes: "The source records the move and carried outcome but does not record a second or seconder.",
        };
    } else {
      content = {
        summary: "Councillor Kukreja moved the recommendations except recommendation seven, and the motion was seconded and carried.",
        "chapter text": "Recommendations except seven seconded and carried",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_unsupported_seconding_refresh",
      label: "8.e Recommendations",
      "source excerpt": "Councillor Kukreja said, 'I would like to move all the other recommendations except recommendation seven.' That motion carries by a vote of five in favour and one opposed.",
      "source rows": 4,
      "duration seconds": 40,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /motion carried/iu);
  assert.doesNotMatch(result.summary, /seconded/iu);
  assert.equal(sourceOnlyRepairCalls, 1);
});

test("stage3 keeps mover and seconder roles separate when a name spelling is disputed", async (t) => {
  let roleRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/faithful speaker roles/iu.test(system)) {
      roleRepairCalls += 1;
      content = {
        summary: "A motion to remove a budget item was moved and seconded, and the motion carried.",
        "chapter text": "Budget-item motion carried",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = roleRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["Councillors Gregg and Mackie moved the motion together."],
          notes: "The source says Councillor Greg moved the motion and Councillor Mackie seconded it; the mover spelling is Greg, not Gregg, and only one mover is recorded.",
        };
    } else {
      content = {
        summary: "Councillors Gregg and Mackie moved to remove a budget item.",
        "chapter text": "Gregg and Mackie moved the budget-item motion",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_mover_seconder_spelling",
      label: "8.f 2026 budget expenditure",
      "source excerpt": "Councillor Greg moved that this budget item be removed, and Councillor Mackie seconded the motion. The motion carried.",
      "source rows": 3,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /motion to remove a budget item.*moved and seconded.*carried/iu);
  assert.doesNotMatch(result.summary, /Gregg|Mackie/iu);
  assert.equal(roleRepairCalls, 1);
});

test("stage3 keeps an incomplete narrative handoff from becoming a presentation", async (t) => {
  let roleRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/faithful speaker roles/iu.test(system)) {
      roleRepairCalls += 1;
      content = {
        summary: "The excerpt continues the machinery narrative without recording a completed presentation.",
        "chapter text": "Machinery narrative continuation",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = roleRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A speaker presented the machinery narrative."],
          notes: "The source is a handoff and mid-sentence continuation; it does not explicitly state a completed presentation or full report.",
        };
    } else {
      content = {
        summary: "A speaker presented the machinery narrative.",
        "chapter text": "Machinery narrative presentation",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_incomplete_narrative_handoff",
      label: "8.g Machinery narrative",
      "source excerpt": "The handoff continues the machinery narrative: for ambulances... The bounded excerpt begins mid-sentence and does not record a completed presentation.",
      "source rows": 2,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /continues the machinery narrative/iu);
  assert.doesNotMatch(result.summary, /presented/iu);
  assert.equal(roleRepairCalls, 1);
});

test("stage3 keeps a proposal and strategy question separate from completed justification", async (t) => {
  let conservativeRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD PROCEDURAL-PAIRING OVERRIDE/iu.test(system)) {
      conservativeRepairCalls += 1;
      content = {
        summary: "The source records a proposal for an additional role and a question about seeing a strategy before approval.",
        "chapter text": "Additional-role proposal and strategy question",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = conservativeRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["Staff justified hiring an additional role."],
          notes: "The source records a proposal and questions about strategy, not a completed justification or approval.",
        };
    } else {
      content = {
        summary: "Staff justified hiring an additional role.",
        "chapter text": "Additional-role justification",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_proposal_status",
      label: "8.h Additional role",
      "source excerpt": "There is a proposal for an additional role. A councillor asked to see a strategy before approving the complement.",
      "source rows": 2,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /proposal/iu);
  assert.match(result.summary, /strategy/iu);
  assert.doesNotMatch(result.summary, /justified|approved|carried/iu);
  assert.equal(conservativeRepairCalls, 1);
});

test("stage3 preserves a conditional deferral recommendation as a recommendation", async (t) => {
  let conservativeRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD RECOMMENDATION-SPEECH-ACT OVERRIDE/iu.test(system)) {
      conservativeRepairCalls += 1;
      content = {
        summary: "The source records a recommendation to defer the main matter until December 12th pending further information.",
        "chapter text": "Recommendation to defer pending information",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = conservativeRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A separate recommendation was made."],
          notes: "The source says 'I would recommend a deferral'; this conditional first-person recommendation does not imply a formal motion was made, seconded, or carried.",
        };
    } else {
      content = {
        summary: "A separate recommendation was made to defer the main matter until December 12th.",
        "chapter text": "Separate deferral recommendation",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_conditional_deferral_recommendation",
      label: "8.i Deferral recommendation",
      "source excerpt": "I would recommend a deferral until December 12th, pending further information.",
      "source rows": 1,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /records a recommendation to defer/iu);
  assert.doesNotMatch(result.summary, /recommendation was made|seconded|carried|approved/iu);
  assert.equal(conservativeRepairCalls, 1);
});

test("stage3 preserves an explicitly paired speaker on a conditional recommendation", async (t) => {
  let conservativeRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD RECOMMENDATION-SPEECH-ACT OVERRIDE/iu.test(system)) {
      conservativeRepairCalls += 1;
      content = {
        summary: "Councillor Scott Greig said he would recommend a deferral until December 12th pending further information.",
        "chapter text": "Scott Greig's conditional deferral recommendation",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = conservativeRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A speaker recommended a deferral."],
          notes: "The source explicitly pairs the conditional recommendation with Councillor Scott Greig; preserve that name without turning the recommendation into a formal motion or outcome.",
        };
    } else {
      content = {
        summary: "A speaker recommended a deferral until December 12th.",
        "chapter text": "Deferral recommendation",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_named_conditional_deferral_recommendation",
      label: "8.i Deferral recommendation",
      "source excerpt": "Councillor Scott Greig said, 'I would recommend a deferral until December 12th, pending further information.'",
      "source rows": 1,
      "duration seconds": 20,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /Scott Greig/iu);
  assert.doesNotMatch(result.summary, /seconded|carried|approved|formal motion/iu);
  assert.equal(conservativeRepairCalls, 1);
});

test("stage3 uses qualified-support repair for mixed support and recommendation speech acts", async (t) => {
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD QUALIFIED-SUPPORT REPAIR OVERRIDE/iu.test(system)) {
      repairCalls += 1;
      content = {
        summary: "A speaker said they would support the proposal while requesting more information. Separately, another speaker said they would recommend a deferral pending that information.",
        "chapter text": "Qualified support and separate recommendation",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = repairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["A separate recommendation was made."],
          notes: "The source records a conditional recommendation and the candidate upgrades it to a completed speech act; the speaker label is disputed.",
        };
    } else {
      content = {
        summary: "Councillor McQueen expressed support contingent on obtaining more information. A separate recommendation was made.",
        "chapter text": "Support and deferral recommendation",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_mixed_qualified_support_recommendation",
      label: "8.i Platform recommendation",
      "source excerpt": "I would support it, but we need more information. I would recommend a deferral until December 12th, pending further information.",
      "source rows": 2,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  const repairedText = `${result.summary} ${result["chapter text"]}`;
  assert.match(repairedText, /would support.*requesting more information/iu);
  assert.doesNotMatch(repairedText, /recommendation was made|supported.*contingent|carried|approved/iu);
  assert.equal(repairCalls, 1);
});

test("stage3 routes a seconding claim through source-aware motion repair", async (t) => {
  let conservativeRepairCalls = 0;
  let auditCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD OPTIONAL-PROCEDURE-DETAIL OVERRIDE/iu.test(system)) {
      conservativeRepairCalls += 1;
      content = {
        summary: "A council member moved the recommendations except recommendation seven, and the motion carried.",
        "chapter text": "Recommendations except seven carried",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      auditCalls += 1;
      content = auditCalls === 1
        ? {
          grounded: false,
          "unsupported claims": ["The proposal description is too broad."],
          notes: "The source records the move and carried outcome; revise the proposal description from the bounded source.",
        }
        : { grounded: true, "unsupported claims": [], notes: "" };
    } else {
      content = {
        summary: "A council member moved the recommendations except recommendation seven, and the motion was seconded and carried.",
        "chapter text": "Recommendations except seven seconded and carried",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_strict_seconding_reintroduction",
      label: "8.e Recommendations",
      "source excerpt": "A council member moved the recommendations except recommendation seven. The motion carried after a vote of five in favour and one opposed.",
      "source rows": 4,
      "duration seconds": 40,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /motion carried/iu);
  assert.doesNotMatch(result.summary, /seconded/iu);
  assert.equal(conservativeRepairCalls, 1);
  assert.equal(auditCalls, 2);
});

test("stage3 keeps a deferral motion's object separate from surrounding discussion", async (t) => {
  let deferralRepairCalls = 0;
  let auditCalls = 0;
  let deferralRepairSystem = "";
  let repairedAuditPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD DEFERRAL-OBJECT OVERRIDE/iu.test(system)) {
      deferralRepairCalls += 1;
      deferralRepairSystem = system;
      content = {
        summary: "A motion to defer the main action until December 12, 2025, pending further information, was moved and carried.",
        "chapter text": "Motion to defer the main action",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      auditCalls += 1;
      if (auditCalls === 2) repairedAuditPrompt = prompt;
      content = auditCalls === 1
        ? {
          grounded: false,
          "unsupported claims": ["The motion deferred discussion of removing an item."],
          notes: "The source defers the underlying action, not the discussion; the procedural meaning changes if the object is described as discussion.",
        }
        : { grounded: true, "unsupported claims": [], notes: "" };
    } else {
      content = {
        summary: "A motion to defer discussion of removing an item was moved, seconded, and carried.",
        "chapter text": "Deferring discussion of removing an item",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_deferral_object",
      label: "Budget discussion",
      "source excerpt": "A motion was made to defer the main action to December 12, 2025, pending further information. The motion was seconded and carried.",
      "source rows": 4,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.match(result.summary, /defer the main action/iu);
  assert.doesNotMatch(result.summary, /defer discussion/iu);
  assert.equal(deferralRepairCalls, 1);
  assert.equal(auditCalls, 2);
  assert.match(deferralRepairSystem, /must not contain .*personal mover\/seconder name or role/iu);
  assert.match(repairedAuditPrompt, /HIGH-PRIORITY DEFERRAL-OBJECT REPAIR RULE/iu);
});

test("stage3 does not attach a separate carried motion to the current discussion", async (t) => {
  let speechActRepairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD SEPARATE-OUTCOME OVERRIDE/iu.test(system)) {
      speechActRepairCalls += 1;
      content = {
        summary: "The committee discussed mapping pavement condition data to transit routes and confirmed that geospatial coordinates are tracked in the city's GIS.",
        "chapter text": "Pavement condition mapping discussion",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = speechActRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The body carried a motion unanimously following the pavement condition discussion."],
          notes: "The source records a question about mapping pavement condition data and a response that coordinates are tracked in GIS, but no motion is moved, seconded, or carried regarding this topic. Following this discussion, a motion is carried, but it is a separate procedural item and the candidate incorrectly attaches that outcome to the current discussion.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = {
        grounded: false,
        "unsupported claims": ["The body carried a motion unanimously following the pavement condition discussion."],
        notes: "The source records a question about mapping pavement condition data and a response that coordinates are tracked in GIS, but no motion is moved, seconded, or carried regarding this topic. Following this discussion, a motion is carried, but it is a separate procedural item and the candidate incorrectly attaches that outcome to the current discussion.",
      };
    } else {
      content = {
        summary: "The body carried a motion unanimously following the pavement condition discussion.",
        "chapter text": "Pavement discussion and carried motion",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_separate_motion",
      label: "8.a.1 Transit Dashboard",
      "source excerpt": "A councillor asked about mapping pavement condition index data to transit routes. Staff confirmed that geospatial coordinates are tracked in the city's GIS. A separate motion was carried unanimously later.",
      "source rows": 3,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "The committee discussed mapping pavement condition data to transit routes and confirmed that geospatial coordinates are tracked in the city's GIS.");
  assert.equal(speechActRepairCalls, 1);
});

test("stage3 repairs an agenda-role attribution when a handoff names the presenter", async (t) => {
  let roleRepairCalls = 0;
  let roleRepairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (/HARD HANDOFF-ROLE OVERRIDE/iu.test(system)) {
      roleRepairCalls += 1;
      roleRepairPrompt = prompt;
      content = {
        summary: "Chris Webb presented the Roads Condition Update and discussed the data collection system and 2026 timeline.",
        "chapter text": "Roads Condition Update presented by Chris Webb",
        confidence: 0.9,
        notes: "",
      };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = roleRepairCalls
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : {
          grounded: false,
          "unsupported claims": ["The Manager of Engineering Services presented the Roads Condition Update."],
          notes: "The candidate summary incorrectly attributes the presentation to the Manager of Engineering Services. The agenda anchor introduces the item from that office and then hands off to Chris Webb; the substantive report was delivered by Chris Webb, not the Manager.",
        };
    } else if (prompt.includes("The prior audit is only an allegation") || prompt.includes("Ignore all prior audit allegations")) {
      content = {
        grounded: false,
        "unsupported claims": ["The Manager of Engineering Services presented the Roads Condition Update."],
        notes: "The candidate summary incorrectly attributes the presentation to the Manager of Engineering Services. The agenda anchor introduces the item from that office and then hands off to Chris Webb; the substantive report was delivered by Chris Webb, not the Manager.",
      };
    } else {
      content = {
        summary: "The Manager of Engineering Services presented the Roads Condition Update.",
        "chapter text": "Roads Condition Update presented by the Manager",
        confidence: 0.9,
        notes: "",
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_role_handoff",
      label: "8.a Roads Condition Update",
      "source excerpt": "We are to our next item from the Manager of Engineering Services. So over to you, Chris Webb. Chris Webb presented the Roads Condition Update and discussed the data collection system and 2026 timeline.",
      "semantic grounding source excerpt": "AUTHORITATIVE HANDOFF SOURCE: the agenda office is provenance; the source hands the item to the named presenter.",
      "source rows": 3,
      "duration seconds": 45,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "Chris Webb presented the Roads Condition Update and discussed the data collection system and 2026 timeline.");
  assert.equal(roleRepairCalls, 1);
  assert.match(roleRepairPrompt, /AUTHORITATIVE HANDOFF SOURCE/iu);
});

test("stage3 reapplies speaker metadata validation after grounding repair", async (t) => {
  let calls = 0;
  let groundingRepairs = 0;
  let metadataRepairPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    let content;
    if (/financial-claim verifier/iu.test(system)) {
      content = { verdict: "PASS", feedback: "No financial claim is present." };
    } else if (prompt.includes("Speaker-metadata retry")) {
      metadataRepairPrompt = prompt;
      content = { summary: "A council representative presented the minutes.", "chapter text": "Minutes presented", confidence: 0.9, notes: "" };
    } else if (prompt.includes("Check every concrete claim in CANDIDATE_SUMMARY")) {
      content = groundingRepairs
        ? { grounded: true, "unsupported claims": [], notes: "" }
        : { grounded: false, "unsupported claims": ["unsupported procedural wording"], notes: "Rewrite the procedural wording." };
    } else if (prompt.includes("The prior audit is only an allegation")) {
      content = { grounded: false, "unsupported claims": ["unsupported procedural wording"], notes: "The rejection remains unresolved." };
    } else if (prompt.includes("Source-grounding repair")) {
      groundingRepairs += 1;
      content = { summary: "Speaker 052 presented the minutes.", "chapter text": "Minutes presented", confidence: 0.9, notes: "" };
    } else {
      content = { summary: "The report required a procedural correction.", "chapter text": "Procedural correction", confidence: 0.9, notes: "" };
    }
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(content) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_metadata_after_repair",
      label: "10 REPORTS OF CITY STAFF",
      "source excerpt": "A representative presented the minutes and corrected the procedure.",
      "source rows": 3,
      "duration seconds": 60,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
    semanticGroundingAudit: true,
  });

  assert.equal(result.summary, "A council representative presented the minutes.");
  assert.equal(groundingRepairs, 1);
  assert.match(metadataRepairPrompt, /grounding 1/iu);
  assert.doesNotMatch(result.summary, /Speaker\s+052/iu);
  assert.equal(calls, 7);
});

test("stage3 retries when sentence cleanup rejects an incomplete summary", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    const summary = calls === 1
      ? "Staff reported development activity across the city"
      : "Staff reported development activity across the city.";
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ summary, "chapter text": "Development update", confidence: 0.9, notes: "" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_006",
      label: "Annual Development Update",
      "source excerpt": "Staff reported development activity across the city.",
      "source word count": 7,
      "source row count": 1,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Staff reported development activity across the city.");
  assert.equal(calls, 2);
});

test("stage3 repairs a financial claim rejected by the final downstream audit", async (t) => {
  let generationCalls = 0;
  let auditCalls = 0;
  let finalRetryPrompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    if (/financial-claim verifier/iu.test(system)) {
      auditCalls += 1;
      const revise = auditCalls === 1 || auditCalls === 3;
      return {
        ok: true,
        async json() {
          return { message: { content: JSON.stringify({
            verdict: revise ? "REVISE" : "PASS",
            claim_type: "aggregate_benefits",
            source_support: "qualified",
            needs_attribution: true,
            needs_category_qualifier: true,
            feedback: revise
              ? "The source reports mixed financial effects, not a reduced net funding result."
              : "The mixed financial categories are attributed and qualified.",
          }) } };
        },
      };
    }
    generationCalls += 1;
    if (/Final financial-claim retry/iu.test(prompt)) finalRetryPrompt = prompt;
    const summary = /Final financial-claim retry/iu.test(prompt) || /Financial-claim retry/iu.test(prompt)
      ? "The report describes mixed savings, staff-hour efficiencies, and new allocations rather than a single funding reduction."
      : "The report describes reduced savings from the proposal.";
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          summary,
          "chapter text": "Mixed financial effects",
          confidence: 0.9,
          notes: "",
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_financial_final_retry",
      label: "Financial effects report",
      "source excerpt": "The report combines reduced transfers, increased staff hours, and new allocations.",
      "source word count": 11,
      "source row count": 1,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(generationCalls, 3);
  assert.equal(auditCalls, 4);
  assert.match(finalRetryPrompt, /REJECTION_REASON:/u);
  assert.match(finalRetryPrompt, /PRIOR_REJECTED_OUTPUT:/u);
  assert.match(result.summary, /mixed savings/u);
});

test("stage3 drops a repeated financial framing on the final bounded repair", async (t) => {
  let generationCalls = 0;
  let auditCalls = 0;
  let finalThirdPrompt = "";
  let finalThirdSystem = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const prompt = request.messages[1].content;
    if (/financial-claim verifier/iu.test(system)) {
      auditCalls += 1;
      const revise = auditCalls >= 2 && auditCalls <= 4;
      return {
        ok: true,
        async json() {
          return { message: { content: JSON.stringify({
            verdict: revise ? "REVISE" : "PASS",
            claim_type: "aggregate_benefits",
            source_support: "qualified",
            needs_attribution: true,
            needs_category_qualifier: true,
            feedback: revise ? "The financial framing remains too direct." : "The candidate is source-faithful.",
          }) } };
        },
      };
    }
    generationCalls += 1;
    if (/Final financial-claim retry 3/iu.test(prompt)) {
      finalThirdPrompt = prompt;
      finalThirdSystem = system;
    }
    const summary = /Final financial-claim retry 3/iu.test(prompt)
      ? "The committee received the report and recorded the proposed next steps."
      : "The report describes savings and financial benefits from the proposal.";
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          summary,
          "chapter text": "The committee received the report.",
          confidence: 0.9,
          notes: "",
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_financial_final_qualitative",
      label: "Insurance report",
      "source excerpt": "The report describes savings, risk management, and future costs.",
      "source word count": 10,
      "source row count": 1,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(generationCalls, 4);
  assert.equal(auditCalls, 4);
  assert.match(finalThirdPrompt, /omit financial claims, amounts, and financial terminology/iu);
  assert.doesNotMatch(finalThirdPrompt, /PRIOR_REJECTED_OUTPUT/u);
  assert.match(finalThirdSystem, /no financial claims, amounts, or financial terminology/iu);
  assert.match(result.summary, /recorded the proposed next steps/u);
});

test("stage3 survives a sustained transient Ollama transport outage", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const originalRetryDelay = process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS;
  process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = "1";
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 5) throw new Error("fetch failed");
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Council received the grounded staff report.",
              "chapter text": "Staff report",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalRetryDelay === undefined) delete process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS;
    else process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = originalRetryDelay;
  });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_outage",
      label: "Staff Report",
      "source excerpt": "Council received the grounded staff report.",
      "source word count": 7,
      "source row count": 1,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "Council received the grounded staff report.");
  assert.equal(calls, 6);
});

test("stage3 uses a qwen prose rewrite when ordinary retries remain fragments", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const isRewrite = request.messages[0].content.includes("rewrite generated civic-report fragments");
    const summary = isRewrite
      ? "Staff reported strong residential and commercial development activity."
      : "strong residential commercial development activity";
    return { ok: true, async json() {
      return { message: { content: JSON.stringify({ summary, "chapter text": "Development update", confidence: 0.9, notes: "" }) } };
    } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await summarizeGroundedUnit({
    unit: { "unit id": "ground_006", label: "Annual Development Update", "source excerpt": "Residential and commercial development remained strong.", "source chars": 56, substantive: true },
    focus: "unusual bits",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Staff reported strong residential and commercial development activity.");
  assert.equal(calls, 3);
});

test("stage3 skips numeric audit when generated prose makes no numeric claim", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("numeric audit should not run"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Council discussed the committee structure and approved the recommendation.",
    chapterText: "Committee structure review",
    sourceExcerpt: "A long grounded transcript with unrelated numbers such as 2025.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.match(result.summary, /approved the recommendation/u);
});

test("stage3 skips numeric audit when generated Arabic numeric notation is already valid", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("valid Arabic numeric notation should not trigger an audit"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "The draft covers 12,640 square kilometers and projects $145,000 in annual levy requirements.",
    chapterText: "Draft transit study spans four counties",
    sourceExcerpt: "The draft covers 12,640 square kilometers and projects $145,000 in annual levy requirements.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "The draft covers 12,640 square kilometers and projects $145,000 in annual levy requirements.");
});

test("stage3 uses qwen to remove an unsupported numeric claim without a prose fallback", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Staff recommends funding the infrastructure work from the capital reserve.",
              "chapter text": "Infrastructure funding",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairUnsupportedNumericClaimsLlm({
    summary: "Staff recommends a $475,000 allocation for the infrastructure work.",
    chapterText: "$475,000 infrastructure allocation",
    sourceExcerpt: "Staff recommends funding the infrastructure work from the capital reserve.",
    unsupportedTokens: ["475000"],
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.unsupportedTokens.length, 0);
  assert.doesNotMatch(result.summary, /475/u);
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
  assert.equal(requestBody.options.num_predict, 720);
  assert.match(requestBody.messages[1].content, /Otherwise omit the unsupported quantity/u);
});

test("stage3 numeric repair never exposes transcript speaker ids as grounded facts", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The committee received the development update.",
              "chapter text": "Development update",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairUnsupportedNumericClaimsLlm({
    summary: "Speaker 072 presented the development update.",
    chapterText: "Speaker 072 development update",
    sourceExcerpt: "SPEAKER_072: The committee received the development update.",
    unsupportedTokens: ["072"],
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.unsupportedTokens.length, 0);
  assert.doesNotMatch(requestBody.messages[1].content, /GROUNDED_SOURCE: SPEAKER_072/u);
  assert.match(requestBody.messages[1].content, /speaker identifiers are internal metadata/u);
});

test("stage3 asks qwen for a qualitative rewrite when numeric correction invents another amount", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 2) {
      assert.match(request.messages[1].content, /without any numeric claims/u);
    }
    const summary = calls === 1
      ? "Staff recommends a $425,796 capital allocation."
      : "Staff recommends funding the work from the capital reserve.";
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary,
              "chapter text": calls === 1 ? "$425,796 capital allocation" : "Capital reserve funding",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairUnsupportedNumericClaimsLlm({
    summary: "Staff recommends a $475,000 capital allocation.",
    chapterText: "$475,000 capital allocation",
    sourceExcerpt: "Staff recommends funding the work from the capital reserve.",
    unsupportedTokens: ["475000"],
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 2);
  assert.equal(result.unsupportedTokens.length, 0);
  assert.doesNotMatch(`${result.summary} ${result.chapterText}`, /\d/u);
});

test("stage3 does not treat the ordinary word one as malformed numeric notation", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("numeric audit should not run"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Council said the framework was one of several options considered and included one-time funding.",
    chapterText: "One of several options",
    sourceExcerpt: "The framework was one of several options considered and included one-time funding.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Council said the framework was one of several options considered and included one-time funding.");
  assert.equal(result.chapterText, "One of several options");
});

test("stage3 uses qwen to remove ambiguous spoken clock notation after exact repair retries", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const isFinalRewrite = request.messages[0].content.includes("resolve malformed numeric notation");
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify(isFinalRewrite
              ? {
                  summary: "Council returned to open session after the closed-session discussion.",
                  "chapter text": "Return to open session",
                }
              : request.messages[0].content.includes("convert exact English numeric phrases")
                ? { replacements: [] }
                : {
                    summary: "Council returned at nine seventeen eighteen after the closed-session discussion.",
                    "chapter text": "Nine seventeen eighteen return",
                    "numeric valid": false,
                  }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await repairNumericFidelityLlm({
    summary: "Council returned at nine seventeen eighteen after the closed-session discussion.",
    chapterText: "Nine seventeen eighteen return",
    sourceExcerpt: "It is nine seventeen, nine eighteen a.m., and Council is returning to the open session.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "Council returned to open session after the closed-session discussion.");
  assert.equal(result.chapterText, "Return to open session");
});

test("stage3 uses fresh qualitative qwen prose when numeric audit JSON stays malformed", async (t) => {
  const originalFetch = globalThis.fetch;
  const previousAttempts = process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS;
  const previousDelay = process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS;
  process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS = "1";
  process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = "1";
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    if (system.includes("correct numeric notation")) {
      return { ok: true, async json() { return { message: { content: "not-json" } }; } };
    }
    assert.match(system, /without numeric claims/u);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "Council returned to open session and reported no direction from the closed session.",
              "chapter text": "Return to open session",
            }),
          },
        };
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousAttempts === undefined) delete process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS;
    else process.env.AGENDA_STAGE3_OLLAMA_ATTEMPTS = previousAttempts;
    if (previousDelay === undefined) delete process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS;
    else process.env.AGENDA_STAGE3_OLLAMA_RETRY_DELAY_MS = previousDelay;
  });

  const result = await repairNumericFidelityLlm({
    summary: "Council returned at nine seventeen eighteen after the closed-session discussion.",
    chapterText: "Nine seventeen eighteen return",
    sourceExcerpt: "It is nine seventeen, nine eighteen a.m., and Council is returning to the open session.",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(calls, 2);
  assert.equal(result.summary, "Council returned to open session and reported no direction from the closed session.");
  assert.equal(result.chapterText, "Return to open session");
  assert.doesNotMatch(`${result.summary} ${result.chapterText}`, /\\d/u);
});

test("stage3 reapplies notation and grounding as one downstream contract", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    let content;
    if (system.includes("Remove unsupported numeric claims")) {
      content = {
        summary: "Council returned to open session and reported no direction from the closed session.",
        "chapter text": "Return to open session",
      };
    } else if (system.includes("correct numeric notation")) {
      content = {
        summary: "Council returned to open session at 9:17 a.m. and reported no direction.",
        "chapter text": "91718 return to open session",
        "numeric valid": true,
      };
    } else if (system.includes("convert exact English numeric phrases")) {
      content = { replacements: [] };
    } else {
      content = {
        summary: "Council returned at nine seventeen eighteen and reported no direction.",
        "chapter text": "Nine seventeen eighteen return",
        confidence: 0.9,
        notes: "",
      };
    }
    return { ok: true, async json() {
      return { message: { content: JSON.stringify(content) } };
    } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_clock",
      label: "Reporting Out of Closed Session",
      "source excerpt": [
        "It is nine seventeen, nine eighteen a.m., and Council is returning to open session.",
        "Council reported that no direction was provided during the closed session.",
      ].join(" "),
      "source word count": 25,
      "source row count": 2,
      substantive: true,
    },
    focus: "",
    llmModel: "qwen3.5:9b",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(
    result.summary,
    "Council returned to open session and reported no direction from the closed session.",
  );
  assert.equal(result.chapterText, "Return to open session");
});

test("numeric audit grounding keeps numeric evidence and adjacent context", () => {
  const excerpt = numericAuditSourceExcerpt([
    "SPEAKER_001: Unrelated opening remarks.",
    "SPEAKER_002: Staff introduced the capital program.",
    "SPEAKER_003: The program includes 77 drainage projects.",
    "SPEAKER_004: Council asked how delivery would be tracked.",
    "SPEAKER_005: Unrelated closing remarks.",
  ].join("\n"));
  assert.match(excerpt, /capital program/u);
  assert.match(excerpt, /77 drainage projects/u);
  assert.match(excerpt, /delivery would be tracked/u);
  assert.doesNotMatch(excerpt, /Unrelated opening/u);
  assert.doesNotMatch(excerpt, /Unrelated closing/u);
});

test("stage3 uses the configured text model for focused numeric repair without replacing prose", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
        message: {
          content: JSON.stringify({
            summary: "Staff described about 77 drainage projects, work on 9th Avenue and 4th Avenue, and the unfinished 16th Avenue sewer.",
            "chapter text": "Capital project updates",
          }),
        },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Staff described about seventy-seven drainage projects, work on Ninth Avenue and Fourth Avenue, and the unfinished Sixteenth Avenue sewer.",
    chapterText: "Capital project updates",
    sourceExcerpt: "about seventy-seven individual drainage projects; Ninth Avenue; Fourth Avenue; 16th Avenue",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.match(result.summary, /77 drainage projects.*9th Avenue.*4th Avenue.*16th Avenue/u);
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
  assert.match(requestBody.messages[1].content, /Keep all non-numeric wording and sentence structure unchanged/u);
});

test("stage3 applies qwen numeric token mappings when prose retries repeat a defect", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const wantsMappings = request.messages[0].content.includes("exact English numeric phrases");
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify(wantsMappings
          ? { replacements: [{ from: "seventy-seven", to: "77" }] }
          : { summary: "Staff tracked seventy-seven projects.", "chapter text": "Project update" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "Staff tracked seventy-seven projects.",
    chapterText: "Project update",
    sourceExcerpt: "Staff reported seventy-seven individual projects.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "Staff tracked 77 projects.");
});

test("stage3 requests omitted numeric mappings one phrase at a time", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const wantsMappings = request.messages[0].content.includes("exact English numeric phrases");
    if (!wantsMappings) {
      return {
        ok: true,
        async json() {
          return { message: { content: JSON.stringify({
            summary: "The plan provides seventy-seven supports and identifies twenty-three positions.",
            "chapter text": "Seventy-seven supports and twenty-three positions",
            "numeric valid": false,
          }) } };
        },
      };
    }
    const phrasesLine = request.messages[1].content.match(/PHRASES: (\[[^\n]+\])/u)?.[1] || "[]";
    const phrases = JSON.parse(phrasesLine);
    const replacements = phrases.length === 1
      ? [{ from: phrases[0], to: phrases[0].toLowerCase() === "seventy-seven" ? "77" : "23" }]
      : [];
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ replacements }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await repairNumericFidelityLlm({
    summary: "The plan provides seventy-seven supports and identifies twenty-three positions.",
    chapterText: "Seventy-seven supports and twenty-three positions",
    sourceExcerpt: "The plan provides seventy-seven supports and identifies twenty-three positions.",
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.equal(result.summary, "The plan provides 77 supports and identifies 23 positions.");
  assert.equal(result.chapterText, "77 supports and 23 positions");
});

test("stage3 preserves composite motion scope across parent handoffs", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({
          summary: "The meeting handed off from staff reports to committee minutes.",
          "chapter text": "Staff reports hand off to minutes",
          confidence: 0.9,
          notes: "",
        }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_container",
      "agenda item": "10",
      status: "container",
      label: "10 REPORTS OF CITY STAFF",
      "source excerpt": "The meeting moved to committee minutes. A motion covered all three listed minutes and was carried.",
      "source rows": 4,
      "duration seconds": 80,
      substantive: false,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.summary, "The meeting handed off from staff reports to committee minutes.");
  assert.equal(requestBody.model, DEFAULT_TEXT_MODEL);
  assert.match(requestBody.messages[1].content, /preserve the complete supported scope/iu);
  assert.match(requestBody.messages[1].content, /parent\/container boundary/iu);
  assert.match(requestBody.messages[1].content, /Structured agenda identity is authoritative/iu);
  assert.match(requestBody.messages[1].content, /never borrow a later neighboring date/iu);
  assert.match(requestBody.messages[1].content, /grounding audit must accept the authoritative label date/iu);
  assert.match(requestBody.messages[1].content, /handoff such as 'back to you for the minutes'.*only a transition/iu);
  assert.match(requestBody.messages[1].content, /If the transcript date is absent or conflicts with the authoritative current label date/iu);
  assert.match(requestBody.messages[1].content, /question-and-answer such as 'Did I cover/iu);
  assert.match(requestBody.messages[1].content, /parent\/container status is not an executable report/iu);
});

test("stage3 scopes a container at its first explicit procedural handoff", () => {
  const result = scopeSourceAtStructuredHandoff(
    {
      status: "container",
      label: "10 REPORTS OF CITY STAFF",
      "source excerpt": [
        "SPEAKER_115: At number ten, reports from city staff.",
        "SPEAKER_056: Could you present the committee minutes first?",
        "SPEAKER_008: The minutes should be approved before this report.",
        "SPEAKER_052: With Council's indulgence, we will jump to committee minutes with recommendations for approval.",
        "SPEAKER_052: From July 9th, we received a report from the Fire Services Administrator.",
      ].join("\n"),
    },
    {
      label: "10.a Report from the Fire Services Administrator",
    },
  );
  assert.equal(result.changed, true);
  assert.match(result.source, /jump to committee minutes/iu);
  assert.doesNotMatch(result.source, /Could you present the committee minutes first/iu);
  assert.doesNotMatch(result.source, /At number ten, reports from city staff/iu);
  assert.doesNotMatch(result.source, /Fire Services Administrator/iu);
});

test("stage3 scopes a mixed parent span at the next structured document identity", () => {
  const result = scopeSourceAtStructuredHandoff(
    {
      label: "12.d Minutes of the Corporate Services Committee meeting held on July 10, 2025",
      "source excerpt": "The Corporate Services Committee minutes were introduced and the motion carried. Community Services Committee. The July 16 minutes were then reviewed.",
    },
    {
      label: "12.e Minutes of the Community Services Committee meeting held on July 16, 2025",
    },
  );
  assert.equal(result.changed, true);
  assert.equal(result.phrase, "Community Services Committee");
  assert.match(result.source, /Corporate Services Committee minutes/u);
  assert.doesNotMatch(result.source, /July 16/u);
});

test("stage3 scopes a correspondence span before an explicit numbered next-item handoff", () => {
  const result = scopeSourceAtStructuredHandoff(
    {
      label: "11.h Correspondence received which is presented for the information of Council",
      "source excerpt": [
        "The speaker discussed correspondence and asked how requests are screened.",
        "Another speaker explained the routing practice.",
        "Okay, if I can move on to number twelve, which is the committee minutes with recommendations for approval.",
        "The next committee minutes were presented and approved.",
      ].join("\n"),
    },
    {
      label: "12 Committee minutes with recommendations for approval",
    },
  );
  assert.equal(result.changed, true);
  assert.match(result.source, /move on to number twelve/iu);
  assert.doesNotMatch(result.source, /The next committee minutes were presented/iu);
});

test("stage3 does not cut minutes chronology at a referenced report identity", () => {
  const result = scopeSourceAtStructuredHandoff(
    {
      label: "12.a Minutes of the Service Review Implementation Ad Hoc Committee meeting held on July 9, 2025",
      "source excerpt": "From July 9th, the committee received a report from the Fire Services Administrator. The minutes were moved for approval and that is carried.",
    },
    {
      label: "10.a Report from the Fire Services Administrator Re: Fleet Strategy Update",
    },
  );
  assert.equal(result.changed, false);
  assert.match(result.source, /minutes were moved for approval/iu);
});

test("stage3 does not cut at a shared current and next committee identity", () => {
  const result = scopeSourceAtStructuredHandoff(
    {
      label: "12.b Minutes of the Closed Session of the Service Review Implementation Ad Hoc Committee meeting held on July 9, 2025",
      "source excerpt": "The Service Review Implementation Ad Hoc Committee minutes were moved for approval. All in favour, and that's carried. The next set was introduced.",
    },
    {
      label: "12.c Minutes of the Service Review Implementation Ad Hoc Committee meeting held on July 16, 2025",
    },
  );
  assert.equal(result.changed, false);
  assert.match(result.source, /that's carried/iu);
});

test("stage3 decision audits accept ordinary debate framing and conservative outcome omission", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ grounded: true, "unsupported claims": [], notes: "" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await auditGroundedSummaryLlm({
    label: "11.a Report CS-25-082",
    summary: "Council debated Report CS-25-082 and discussed whether to defer it.",
    sourceExcerpt: "Council discussed the report. A motion to defer the report was proposed and defeated.",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });
  assert.match(requestBody.messages[1].content, /ordinary framing such as 'the body discussed' or 'the body debated the report'/iu);
  assert.match(requestBody.messages[1].content, /omission is a coverage issue unless the candidate denies/iu);
});

test("stage3 keeps the current motion before an explicit next-set handoff", () => {
  const result = scopeSourceAtStructuredHandoff(
    {
      label: "12.b Minutes of the Closed Session of the Service Review Implementation Ad Hoc Committee meeting held on July 9, 2025",
      "source excerpt": "The speaker moved for approval of the minutes. All in favour, and that's carried. And right back to you for the next set. Later minutes content must not be attached here.",
    },
    {
      label: "12.c Minutes of the Service Review Implementation Ad Hoc Committee meeting held on July 16, 2025",
    },
  );
  assert.equal(result.changed, true);
  assert.match(result.source, /that's carried/iu);
  assert.match(result.source, /next set/iu);
  assert.doesNotMatch(result.source, /Later minutes content/iu);
});

test("stage3 guards generated prose against conflicting structured agenda dates", () => {
  const source = fs.readFileSync(
    new URL("../program/library/reporter_shared/agenda-stage3-summary-renderer.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /conflictingStructuredDateClaim/iu);
  assert.match(source, /repairStructuredDateIdentity/iu);
  assert.match(source, /removeAllowedStructuredDateAuditClaims/iu);
  assert.match(source, /queryConservativeMinutesHandoffRepair/iu);
  assert.match(source, /minutesHandoffOnly/iu);
  assert.match(source, /REPORT_PROPOSAL_STATUS_RULE/iu);
  assert.match(source, /PUBLIC_COMMENT_PLAN_AMENDMENT_RULE/iu);
  assert.match(source, /PROCEDURAL_CHAPTER_ORTHOGONALITY_RULE/iu);
  assert.match(source, /ORDINAL_MOTION_SEQUENCE_RULE/iu);
  assert.match(source, /ordinalMotionSequenceOnly/iu);
  assert.match(source, /do not call a later motion pending, approved, carried, defeated, or under consideration merely because it is described as a next step/iu);
  assert.match(source, /explicit disposition such as 'that motion is defeated' controls the motion immediately under discussion/iu);
  assert.match(source, /do not transfer a later motion's scope or roll-call count to an earlier motion/iu);
  assert.match(source, /preserve the count's order and labels/iu);
  assert.match(source, /do not describe one motion's vote as a split between retaining and removing alternatives/iu);
  assert.match(source, /If an earlier minutes motion is simply said to be carried without a spoken roll call, omit a vote count/iu);
  assert.match(source, /When more than one motion appears in this bounded chunk, omit all vote counts unless the source pairs the count unmistakably/iu);
  assert.match(source, /A listed or on-screen first option is not a moved first motion/iu);
  assert.match(source, /explicitly identifies the first motion on screen.*matching motion to move.*that motion is defeated/iu);
  assert.match(source, /first or initial moved motion was defeated/iu);
  assert.match(source, /If literal motion evidence has no explicit first-motion record, never write that a first motion was moved/iu);
  assert.match(source, /phrase 'on the table' without a numbered subject is not a first-motion action/iu);
  assert.match(source, /const reportProposalScopeOnly = !\/\\bminutes\\b\/iu\.test/iu);
  assert.match(source, /an earlier motion was 'defeated'.*discussion referred to an earlier defeated motion/iu);
  assert.match(source, /accept concise wording that the earlier motion concerned that process/iu);
  assert.match(source, /explicitly says a member will move to accept the staff recommendation.*subsequent question is carried/iu);
  assert.match(source, /if it says the report 'provides a proposed process'.*do not rewrite that as 'the report proposes'/iu);
  assert.match(source, /Keep later discussion of limiting outreach.*separate from the report's initial proposed process/iu);
  assert.match(source, /explicitly says the earlier defeated motion would have sought expressions of interest/iu);
  assert.match(source, /Do not combine a later proposal to limit outreach.*final carried staff recommendation/iu);
  assert.match(source, /neutral impersonal framing only when the literal source supports that exact report or item identity/iu);
  assert.doesNotMatch(source, /neutral impersonal framing.*The report description included a proposed process/iu);
  assert.match(source, /Do not infer a historical defeat from public comments/iu);
  assert.match(source, /A source phrase that public comments were received at a public meeting.*does not establish a motion/iu);
  assert.match(source, /Hard constraint: when the source contains public comments about the need for an official plan amendment.*no explicit motion and defeated disposition.*do not use defeated/iu);
  assert.match(source, /queryConservativePublicCommentRepair/iu);
  assert.match(source, /required for construction or development supports ordinary faithful framing/iu);
  assert.match(source, /Required modality for a narrated report.*neutral impersonal document framing/iu);
  assert.match(source, /eligibility was limited.*local partners were identified/iu);
  assert.match(source, /Hard constraint: do not make any presenter.*the governing body/iu);
  assert.match(source, /include both when both are material to the bounded source's status/iu);
  assert.match(source, /write both layers in the summary.*Do not return a proposal-only summary/iu);
  assert.match(source, /Do not say that a proposal or motion 'was amended'.*unless the source explicitly records that amendment being adopted or carried/iu);
  assert.match(source, /Do not say that the report's proposed process itself was defeated or rejected/iu);
  assert.match(source, /current amendment discussion has no recorded final disposition/iu);
  assert.match(source, /GENERIC-ACTOR AUDIT OVERRIDE/iu);
  assert.match(source, /replacement must not contain 'a speaker', 'another speaker', 'a third speaker'/iu);
  assert.match(source, /Do not use a generic actor to preserve an unsupported action/iu);
  assert.match(source, /INDEPENDENT_AUDIT_REJECTION \(UNTRUSTED REPAIR CONTEXT\)/iu);
  assert.match(source, /omit the entire actor-specific clause/iu);
  assert.match(source, /A first-person statement that someone would or could support an idea.*is not by itself institutional consideration/iu);
  assert.match(source, /Do not import a later motion or deferral from outside the supplied bounded source window/iu);
  assert.match(source, /BOUNDED SPEECH-ACT OVERRIDE/iu);
  assert.match(source, /A procedural handoff such as 'take questions after \[item\]'.*not by itself evidence/iu);
  assert.match(source, /PROCEDURAL-HANDOFF ATTRIBUTION OVERRIDE/iu);
  assert.match(source, /An uncompleted suggestion that a matter may be deferred.*is not an actual motion or decision/iu);
  assert.match(source, /INCOMPLETE-DEFERRAL OVERRIDE/iu);
  assert.match(source, /ACTOR-AUDIT FINAL OVERRIDE/iu);
  assert.match(source, /output no disputed personal name, office, title, or generic actor at all/iu);
  assert.match(source, /UNIVERSAL BOUNDED-SOURCE PROSE CONTRACT/iu);
  assert.match(source, /If the window ends before a motion, vote, deferral, recommendation outcome, or conclusion/iu);
  assert.match(source, /A possibility, conditional support statement, request for a future motion, recommendation to defer, or proposed deferral is not a completed decision/iu);
  assert.match(source, /Preserve a speaker's personal uncertainty, interest, or need for information as that speaker's statement/iu);
  assert.match(source, /When the source explicitly records that a motion was moved and seconded, accept a generic paraphrase/iu);
  assert.match(source, /chair's or clerk's procedural announcement.*explicit source record.*moved and seconded/iu);
  assert.match(source, /motion introduction\/reporting separate from institutional disposition.*member who reports or moves.*not the actor who carries/iu);
  assert.match(source, /When the source explicitly records a speaker making a recommendation, accept 'a speaker recommended X'/iu);
  assert.match(source, /Accept a generic speech-act paraphrase such as 'a speaker recommended deferral until December 12th pending further information'.*not a formal motion/iu);
  assert.match(source, /Willingness, availability, or openness to take direction/iu);
  assert.match(source, /When a speaker only verbally suggests an amendment or deferral.*use 'a speaker suggested'/iu);
  assert.match(source, /When no formal motion is recorded.*prefer 'a speaker suggested'/iu);
  assert.match(source, /tentative first-person question such as 'I'm wondering if we can amend'.*proposed amendment/iu);
  assert.match(source, /'I would recommend a deferral'.*speaker recommended deferral/iu);
  assert.match(source, /Accept neutral speech-act wording such as 'a possible amendment was discussed'.*recommended deferral.*not assert/iu);
  assert.match(source, /Preserve conditional relationships: if the source says 'if X, Y could\/may happen'/iu);
  assert.match(source, /const CAUSAL_RELATIONSHIP_AUDIT_RULE =/iu);
  assert.match(source, /adjacency.*insufficient to pair the subject with a nearby benefit/iu);
  assert.match(source, /causalPurposeConstructionDefect/iu);
  assert.match(source, /const queryConservativeCausalRelationshipRepair = async/iu);
  assert.match(source, /two independent source-grounded sentences.*omit the secondary benefit/iu);
  assert.match(source, /The preceding causal-separation repair still connected the proposal and benefit/iu);
  assert.match(source, /HARD CAUSAL-RELATIONSHIP OVERRIDE.*nearby benefit.*purpose, reason, motivation/iu);
  assert.match(source, /const causalRelationshipDefect =/iu);
  assert.match(source, /const CONDITIONAL_RELATIONSHIP_AUDIT_RULE =/iu);
  assert.match(source, /retain the if-condition and modal/iu);
  assert.match(source, /Do not rewrite X as a current or completed fact/iu);
  assert.match(source, /const conditionalRelationshipDefect =/iu);
  assert.match(source, /const queryConservativeConditionalRelationshipRepair = async/iu);
  assert.match(source, /HARD CONDITIONAL-RELATIONSHIP OVERRIDE.*ongoing, current, unconditional/iu);
  assert.match(source, /function collectiveActorGroundingDefect\(text = ""\)/iu);
  assert.match(source, /const GENERIC_PLURAL_ACTOR_FIDELITY_RULE =/iu);
  assert.match(source, /When the source pairs the retained claim with one speaker.*singular 'a speaker'/iu);
  assert.match(source, /function genericPluralActorGroundingDefect\(text = ""\)/iu);
  assert.match(source, /HARD GENERIC-PLURAL-ACTOR OVERRIDE.*plural generic actor.*one source speaker/iu);
  assert.match(source, /const genericPluralActorDefect = genericPluralActorGroundingDefect\(auditFeedback\)/iu);
  assert.match(source, /queryConservativeGenericPluralActorRepair/iu);
  assert.match(source, /finalGenericPluralActorDefect/iu);
  assert.match(source, /function unsupportedQualifierGroundingDefect\(text = ""\)/iu);
  assert.match(source, /Do not add descriptive qualifiers such as 'new', 'updated', 'current'/iu);
  assert.match(source, /HARD UNSUPPORTED-QUALIFIER OVERRIDE.*Remove only that unsupported modifier/iu);
  assert.match(source, /const unsupportedQualifierDefect = unsupportedQualifierGroundingDefect\(auditFeedback\)/iu);
  assert.match(source, /queryConservativeUnsupportedQualifierRepair/iu);
  assert.match(source, /finalUnsupportedQualifierDefect/iu);
  assert.match(source, /const PARENT_AUDITED_CHILD_EVIDENCE_RULE =/iu);
  assert.match(source, /const FRAGMENTED_TRANSCRIPT_GROUNDING_RULE =/iu);
  assert.match(source, /adjacent lines in the same bounded source/iu);
  assert.match(source, /function fragmentedTranscriptGroundingDefect/iu);
  assert.match(source, /queryConservativeFragmentedSourceRepair/iu);
  assert.match(source, /final fragmented-source repair/iu);
  assert.match(source, /const candidateUpgradesRecommendation =/iu);
  assert.match(source, /recommendationSpeechActDefect && sourceConditionalRecommendation/iu);
  assert.match(source, /independently generated and semantically audited against their complete paired source windows/iu);
  assert.match(source, /parentAuditedChildEvidence/iu);
  assert.match(source, /COMPACT AUDITED CHILD COVERAGE:/iu);
  assert.match(source, /literal anchors remain authoritative for corrections/iu);
  assert.match(source, /const compactParentCoverage = sourceParts/iu);
  assert.match(source, /COMPACT AUDITED CHILD COVERAGE/iu);
  assert.match(source, /Compose the parent overview from every compact coverage segment/iu);
  assert.match(source, /HARD COLLECTIVE-ATTRIBUTION OVERRIDE.*individually attributed remarks.*unsupported collective/iu);
  assert.match(source, /COLLECTIVE-ATTRIBUTION SAFE RESOLUTION.*Directors discussed.*staff noted/iu);
  assert.match(source, /SYSTEM-LEVEL COLLECTIVE-ATTRIBUTION BLOCKLIST/iu);
  assert.match(source, /const collectiveActorDefect = collectiveActorGroundingDefect\(auditFeedback\)/iu);
  assert.match(source, /acknowledgment, tentative plan.*'we'll look to the CAO'.*not.*recommendation/iu);
  assert.match(source, /If an independent audit says a motion subject is absent or unpaired in this bounded window/iu);
  assert.match(source, /If the audit evidence is internally contradictory.*recheck the exact supplied bounded source/iu);
  assert.match(source, /This is an included-claim audit, not a completeness test/iu);
  assert.match(source, /Do not reject a true generic moved-and-seconded claim.*on the floor for discussion/iu);
  assert.match(source, /Accept proposal-stage wording such as 'a motion to remove an expenditure was moved and seconded; it was on the floor for discussion'.*does not claim.*completed outcome/iu);
  assert.match(source, /explicit announcement such as 'it's been moved by .* and seconded by .*'.*direct evidence of motion introduction/iu);
  assert.match(source, /'I would support it'.*qualified or conditional support.*supported a proposal/iu);
  assert.match(source, /chair or clerk says a motion is 'now on the floor for discussion'.*impersonal status wording/iu);
  assert.match(source, /HIGH-PRIORITY PROCEDURAL-FLOOR STATUS RULE.*no disposition is recorded/iu);
  assert.match(source, /HIGH-PRIORITY BOUNDED-PROCEDURE ABSENCE RULE.*no disposition was recorded/iu);
  assert.match(source, /Never write the gerund construction 'placing the item on the floor for discussion'/iu);
  assert.match(source, /bounded source ends mid-phrase or mid-sentence.*do not complete the missing object/iu);
  assert.match(source, /Keep an explicit motion subject separate from debate context.*'regarding', 'about', or 'whether'/iu);
  assert.match(source, /Treat phrases such as 'the motion is not on the floor' or 'motion not on the floor' as procedural or quoted discussion language/iu);
  assert.match(source, /Do not attach a nearby conditional consequence such as 'if the body decides to remove an item'/iu);
  assert.match(source, /Never replace remove, defer, return, bring back, or a possible future discussion with 'reconsider'/iu);
  assert.match(source, /Preserve literal actor spelling and identity.*Greg, Gray, or Gregg/iu);
  assert.match(source, /Procedural-floor repair: the source's chair-announced status must be impersonal/iu);
  assert.match(source, /SYSTEM-LEVEL PROCEDURAL-FLOOR REPAIR.*never write 'placing the item on the floor for discussion'/iu);
  assert.match(source, /const queryProceduralFloorRepair = async/iu);
  assert.match(source, /const queryConservativeIncompleteDeferralRepair = async/iu);
  assert.match(source, /const queryConservativeIncompleteProposalRepair = async/iu);
  assert.match(source, /const queryConservativeNumericConflictRepair = async/iu);
  assert.match(source, /const queryConservativeMotionSubjectRepair = async/iu);
  assert.match(source, /Never use 'placing', 'placed', 'brought', 'put', or 'moved' the item onto the floor/iu);
  assert.match(source, /never include a personal name for a mover or seconder.*council member moved/iu);
  assert.match(source, /Do not normalize, phonetic-match, or choose among conflicting forms such as Greg, Gray, Gregg, or Paul Mcqueen/iu);
  assert.match(source, /motion being moved and seconded but only says it is on the floor for discussion.*no disposition was recorded/iu);
  assert.match(source, /If a clause is disputed, ambiguous, or requires a name, role, qualifier, or procedural label.*omit that clause instead of guessing/iu);
  assert.match(source, /Preserve qualified staff speech exactly.*through you, Warden/iu);
  assert.match(source, /REJECTION_REASON:/iu);
  assert.match(source, /FINAL OUTPUT CHECK:.*no personal mover or seconder name.*no completed outcome/iu);
  assert.match(source, /FINAL ROLE OUTPUT CHECK:.*chair-announced floor status.*never output placing/iu);
  assert.match(source, /source window that ends mid-sentence.*cannot supply the missing procedural act/iu);
  assert.match(source, /Never write 'a motion to defer was recorded'.*item was deferred/iu);
  assert.match(source, /If the bounded source literally says 'I would recommend a deferral'.*speaker recommended deferral.*possible-deferral form/iu);
  assert.match(source, /When this bounded source contains both amendment\/referral discussion and an explicit deferral recommendation.*Never combine them/iu);
  assert.match(source, /const incompleteDeferralDefect =/iu);
  assert.match(source, /const incompleteProposalDefect =/iu);
  assert.match(source, /does\s+not\s+record|specific\s+content|suggest\(\?:ed\|ing\)/iu);
  assert.match(source, /source ends mid-sentence.*do not complete the missing referral target/iu);
  assert.match(source, /For an incomplete amendment, do not include any object, referral target, committee, audience, reason, or continuation/iu);
  assert.match(source, /const motionSubjectDefect =/iu);
  assert.match(source, /const actorAttributionConflict =/iu);
  assert.match(source, /conflicting or unsupported named actor.*Omit every disputed personal name/iu);
  assert.match(source, /const CONDITIONAL_STATEMENT_FIDELITY_RULE/iu);
  assert.match(source, /accept a concise attribution such as 'the speaker said that if the body decides X/iu);
  assert.match(source, /const DEFERRAL_PROPOSAL_STATUS_RULE/iu);
  assert.match(source, /when the source says that an item 'could be deferred'.*do not call that a recommendation that was made/iu);
  assert.match(source, /const numericConflictDefect =/iu);
  assert.match(source, /function causalRelationshipConstructionDefect\(text = ""\)/iu);
  assert.match(source, /const finalCausalRelationshipDefect =/iu);
  assert.match(source, /stage3 final causal-relationship repair/iu);
  assert.match(source, /const numericSpecificityDefect =/iu);
  assert.match(source, /let numericSpecificityRepairActive = false/iu);
  assert.match(source, /numericSpecificityRepairActive/iu);
  assert.match(source, /const queryConservativeNumericSpecificityRepair = async/iu);
  assert.match(source, /HARD EXPLICIT-NUMERIC-SPECIFICITY OVERRIDE.*explicitly supplies a numeric amount/iu);
  assert.match(source, /Do not describe that supported detail as unspecified, unknown, unclear, or not given/iu);
  assert.match(source, /const finalNumericConflictDefect =/iu);
  assert.match(source, /stage3 final numeric-conflict repair/iu);
  assert.match(source, /function conditionalDeferralRecommendationSource\(text = ""\)/iu);
  assert.match(source, /GENERIC_SPEAKER_QUESTION_RULE.*a speaker asked about/iu);
  assert.match(source, /EXPLICIT_PROPOSAL_PARAPHRASE_RULE.*proposal involved/iu);
  assert.match(source, /const finalConditionalRecommendationDefect =/iu);
  assert.match(source, /stage3 final conditional-deferral repair/iu);
  assert.match(source, /const queryConservativeUnsupportedSpeechActRepair = async/iu);
  assert.match(source, /const unsupportedSpeechActDefect =/iu);
  assert.match(source, /const finalUnsupportedSpeechActDefect =/iu);
  assert.match(source, /stage3 final unsupported-speech-act repair/iu);
  assert.match(source, /const finalNumericSpecificityDefect =/iu);
  assert.match(source, /stage3 final numeric-specificity repair/iu);
  assert.match(source, /const proceduralPairingDefect =/iu);
  assert.match(source, /queryProceduralFloorRepair\(groundingAttempt, auditFeedback, rejectedOutput\)/iu);
  assert.match(source, /conflicting numeric\/date\/year readings.*never choose.*disputed numeric detail/iu);
  assert.match(source, /not\s+on\s+the\s+floor|procedural\s+\(\?:nature\|discussion\)/iu);
  assert.match(source, /const generatedProse =/iu);
  assert.match(source, /proceduralFloorDefect = .*test\(generatedProse\)/iu);
  assert.match(source, /const rawChapterUnit = sourceChapters\[ci\]/iu);
  assert.match(source, /scopeSourceAtStructuredHandoff\(\s*\{[\s\S]{0,500}\.\.\.rawChapterUnit/iu);
  assert.match(source, /scoped child unit=\$\{unitId\}/iu);
  assert.match(source, /Keep the motion's literal object, scope, and outcome separate from a related topic/iu);
  assert.match(source, /Return ordinary grammatical prose, not audit notes or extracted fragments.*vertical bars/iu);
  assert.match(source, /Never use 'placing', 'placed', 'brought', 'put', or 'moved' the item onto the floor/iu);
  assert.match(source, /Preserve conditional and hypothetical language exactly/iu);
  assert.match(source, /possible reserve-funded reduction.*could or may reduce/iu);
  assert.match(source, /The words discussion or discussed may neutrally compress multiple source remarks/iu);
  assert.match(source, /Accept discussion or discussed as neutral compression of multiple source remarks/iu);
  assert.match(source, /Adjacent transcript chapters may share the same proceeding.*distinct procedural stage/iu);
  assert.match(source, /heading-only source such as 'confirmation of council minutes'/iu);
  assert.match(source, /The agenda listed confirmation of the council minutes/iu);
  assert.match(source, /literal-description form beginning 'The transcript records'/iu);
  assert.match(source, /handoff-only span with no minutes content/iu);
  assert.match(source, /handoff.*only a transition, not a completed presentation/iu);
  assert.match(source, /without recording their presentation or approval.*grounded/iu);
  assert.match(source, /narrative statement such as 'Council postponed the earlier committee minutes.*historical or referenced-minute content/iu);
  assert.match(source, /Match every disposition to the motion or item it directly follows/iu);
  assert.match(source, /When the same excerpt later says that the first motion was defeated, that explicit current motion disposition controls/iu);
  assert.match(source, /conflicting transcript or ASR date/iu);
});

test("stage3 treats omitted source qualifiers as coverage, not a grounding defect", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({ grounded: true, "unsupported claims": [], notes: "The retained request is supported." }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await auditGroundedSummaryLlm({
    label: "8 Corporate Services",
    summary: "Councillor Rier requested historical and projected data on professional development expenses.",
    sourceExcerpt: "Councillor Rier asked what professional development expenses were four years ago and what they were projected to be in the 2027 budget.",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.grounded, true);
  assert.match(requestBody.messages[1].content, /HIGH-PRIORITY GENERAL GROUNDING RULE/iu);
  assert.match(requestBody.messages[1].content, /exact past and forecast periods/iu);
  assert.match(requestBody.messages[1].content, /coverage issue, not an unsupported claim/iu);
});

test("stage3 keeps exact source dates and numbers ahead of inferred chronology", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({ grounded: true, "unsupported claims": [], notes: "The exact source year is supported." }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await auditGroundedSummaryLlm({
    label: "8 Corporate Services",
    summary: "The presentation described the draft working budget for 2024 and forecasts through 2028.",
    sourceExcerpt: "The presentation described the working budget for 2024 and the 2028 forecast.",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.equal(result.grounded, true);
  assert.match(requestBody.messages[1].content, /HIGH-PRIORITY LITERAL DATE AND NUMBER RULE/iu);
  assert.match(requestBody.messages[1].content, /Do not replace an exact source value with a year inferred from the meeting date/iu);
});

test("stage3 omits routine no-question transitions from mixed child chunks", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "The property budget included maintenance and capital costs.",
              "chapter text": "Property budget includes maintenance costs",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_mixed_questions",
      label: "6.a Budget documents",
      "source excerpt": "The property budget included maintenance and capital costs. Any questions on property? Not seeing any. Thank you.",
      "source rows": 5,
      "duration seconds": 120,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.match(requestBody.messages[1].content, /routine invitation for questions.*omit that exchange/iu);
  assert.match(requestBody.messages[1].content, /preceding question inferred from an answer/iu);
});

test("stage3 preserves qualified support when the same source block contains information requests", async (t) => {
  let requestBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: JSON.stringify({
              summary: "A speaker said they would support the proposal while requesting more information.",
              "chapter text": "Speaker gives qualified support",
              confidence: 0.9,
              notes: "",
            }),
          },
        };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await summarizeGroundedUnit({
    unit: {
      "unit id": "ground_qualified_support",
      label: "4.a Proposal discussion",
      "source excerpt": "I would support it, but we need more information before deciding.",
      "source rows": 2,
      "duration seconds": 30,
      substantive: true,
    },
    focus: "newsworthy factual civic reporting",
    llmModel: DEFAULT_TEXT_MODEL,
    ollamaUrl: "http://ollama.invalid/api/chat",
  });

  assert.match(requestBody.messages[1].content, /same source block contains qualified support/iu);
  assert.match(requestBody.messages[1].content, /never use unconditional past-tense 'supported'/iu);
  assert.match(requestBody.messages[1].content, /said they would support the proposal while requesting more information/iu);
});
