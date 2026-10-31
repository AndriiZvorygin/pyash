import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnglishLemmaVerificationPrompt,
  createQueuedMindEnglishLemmaVerifier,
  parseEnglishLemmaVerificationResponse,
  verifyEnglishLemmaCandidates
} from "../program/library/translation/english_lemma_verification.mjs";
import { englishLemmaCandidateId } from "../program/library/translation/english_lemmas.mjs";

function candidate(surface, lemma, pya) {
  const record = {
    surface,
    lemma,
    canonicalEnglish: lemma,
    pyashSequence: [pya],
    kind: "inflectional",
    status: "candidate",
    rule: "fixture",
    evidence: "fixture candidate"
  };
  return { ...record, id: englishLemmaCandidateId(record) };
}

test("lemma verifier parses fenced and noisy provider JSON", () => {
  const first = candidate("axes", "axis", "axis");
  const second = candidate("axes", "axe", "axe");
  const response = parseEnglishLemmaVerificationResponse(
    [
      "provider preface",
      "```json",
      JSON.stringify({ verdict: "accept", candidateId: first.id, rationale: "plural of axis" }),
      "```",
      "provider suffix"
    ].join("\n"),
    { candidates: [first, second] }
  );
  assert.equal(response.valid, true);
  assert.equal(response.candidateId, first.id);
  assert.equal(parseEnglishLemmaVerificationResponse("noise only", { candidates: [first] }).valid, false);
  assert.equal(parseEnglishLemmaVerificationResponse(JSON.stringify({ verdict: "accept", candidateId: "outside", rationale: "x" }), { candidates: [first] }).valid, false);
});

test("lemma verifier keeps malformed output bounded and repairs once", async () => {
  const first = candidate("axes", "axis", "axis");
  const second = candidate("axes", "axe", "axe");
  const calls = [];
  const result = await verifyEnglishLemmaCandidates([first, second], {
    invoke: async (request) => {
      calls.push(request);
      if (request.phase === "verify") return "provider output without JSON";
      return JSON.stringify({ verdict: "accept", candidateId: first.id, rationale: "source form is a plural of axis" });
    },
    maxRepairAttempts: 1
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].phase, "verify");
  assert.equal(calls[1].phase, "repair");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.accepted[0].lemma, "axis");
  assert.equal(result.rejected[0].lemma, "axe");
});

test("lemma verifier retains uncertain records after a bounded failure", async () => {
  const row = candidate("axes", "axis", "axis");
  const result = await verifyEnglishLemmaCandidates([row], {
    invoke: async () => "still malformed",
    maxRepairAttempts: 1
  });
  assert.equal(result.uncertain.length, 1);
  assert.equal(result.uncertain[0].verificationAttempts, 2);
  assert.equal(result.uncertain[0].verificationStatus, "uncertain-llm");
});

test("queued lemma verifier uses the existing future GPU duty and await path", async () => {
  const calls = [];
  const parse = (sentence) => sentence;
  const interpret = async (sentence) => {
    calls.push(sentence);
    return calls.length === 1
      ? { ob: { text: "queued" } }
      : { ob: { text: "success" }, result: { text: '{"verdict":"accept"}' } };
  };
  const invoke = createQueuedMindEnglishLemmaVerifier({ interpret, parse, timeoutMs: 1000 });
  const row = candidate("axes", "axis", "axis");
  const result = await invoke({ prompt: buildEnglishLemmaVerificationPrompt({ record: row, candidates: [row] }), record: row });
  assert.match(calls[0], /vyah start future be gpu mind do/u);
  assert.match(calls[1], /vyah await be gpu do/u);
  assert.match(result, /verdict/u);
});
