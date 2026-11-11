import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisionAppend,
  renderEnglishWordNetCompoundDecisions
} from "../program/library/translation/english_wordnet_compound_decisions.mjs";

test("decision ledger appends updates and resolves each candidate to its latest row", () => {
  const first = {
    candidateId: "candidate-one",
    target: "example",
    pyashSequence: ["hfoo", "hbar"],
    status: "rejected-llm",
    decisionRevision: "prompt-v1"
  };
  const update = {
    ...first,
    status: "accepted-llm",
    decisionRevision: "prompt-v2",
    promotionStatus: "promoted-to-derived-index"
  };

  const source = renderEnglishWordNetCompoundDecisions([first])
    + renderEnglishWordNetCompoundDecisionAppend(update);
  const parsed = parseEnglishWordNetCompoundDecisions(source);

  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.byId.get(first.candidateId), update);
});
