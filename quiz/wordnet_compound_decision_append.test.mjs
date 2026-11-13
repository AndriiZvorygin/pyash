import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEnglishWordNetCompoundDecisionOffsetIndex,
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

test("decision offset index loads only requested rows and tracks later appends", async () => {
  const first = {
    candidateId: "candidate-one",
    target: "example",
    pyashSequence: ["hfoo", "hbar"],
    status: "rejected-llm",
    decisionRevision: "prompt-v1"
  };
  const other = {
    candidateId: "candidate-other",
    target: "sample",
    pyashSequence: ["hbaz", "hqux"],
    status: "accepted-llm",
    decisionRevision: "prompt-v1"
  };
  const update = {
    ...first,
    status: "accepted-llm",
    decisionRevision: "prompt-v2",
    promotionStatus: "promoted-to-derived-index"
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "pyash-compound-decision-index-"));
  const ledgerPath = path.join(directory, "decisions.pya");
  try {
    await writeFile(ledgerPath, renderEnglishWordNetCompoundDecisions([first, other]), "utf8");
    const index = await createEnglishWordNetCompoundDecisionOffsetIndex({ url: ledgerPath });
    const selected = await index.load([first.candidateId]);

    assert.deepEqual(selected.rows, [first]);
    assert.equal(selected.byId.has(other.candidateId), false);

    const startingOffset = (await stat(ledgerPath)).size;
    const append = renderEnglishWordNetCompoundDecisionAppend(update);
    await appendFile(ledgerPath, append, "utf8");
    index.noteAppended([update], startingOffset);

    const latest = await index.load([first.candidateId]);
    assert.deepEqual(latest.byId.get(first.candidateId), update);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
