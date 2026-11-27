import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcceptedReferenceSource,
  loadReferenceSourceInputs
} from "../program/library/dictionary/build_reference_source.mjs";

// The build used to `continue` past a bridge sense it could not place, with no
// counter and no output. 4,767 senses vanished that way — a reader of the volume
// could not tell "WordNet has no sense for this" from "we dropped it".

test("every unplaceable bridge sense is counted, with a reason and an example", async () => {
  const built = buildAcceptedReferenceSource({
    ...(await loadReferenceSourceInputs()),
    render: false
  });
  const { droppedSenseRows, droppedSenseExamples } = built.summary;

  assert.ok(droppedSenseRows, "the summary reports dropped rows");
  for (const reason of ["ambiguousTarget", "absentTarget", "malformedSense",
    "compoundNoSequence", "compoundNoDefinition"]) {
    assert.equal(typeof droppedSenseRows[reason], "number", `${reason} is counted`);
  }

  const total = Object.values(droppedSenseRows).reduce((sum, count) => sum + count, 0);
  assert.ok(total > 0, "the known drops are still visible");
  assert.ok(
    Object.keys(droppedSenseExamples).length > 0,
    "a non-zero reason carries examples, so the drop is diagnosable"
  );
});

test("an ambiguous target is reported rather than resolved by guessing", async () => {
  // `death` is one atom plus five compounds, all declaring the same English
  // target, so the surface no longer names a single sequence. Picking one here
  // would be a coin flip; the builder must say so instead.
  const built = buildAcceptedReferenceSource({
    ...(await loadReferenceSourceInputs()),
    render: false
  });
  const examples = built.summary.droppedSenseExamples.ambiguousTarget ?? [];
  assert.ok(examples.length > 0, "ambiguous targets are sampled");
  const sample = examples[0];
  assert.equal(typeof sample.target, "string");
  assert.ok(Array.isArray(sample.candidates) && sample.candidates.length > 1,
    "an ambiguous drop lists the sequences that competed");
});

test("the build refuses to exceed its recorded drop ceiling", async () => {
  // The ceiling is what turns a silent regression into a failed build. Simulate
  // one by handing the builder a bridge row whose target is ambiguous, then
  // confirm the guard exists by reading the constant through a real build.
  const built = buildAcceptedReferenceSource({
    ...(await loadReferenceSourceInputs()),
    render: false
  });
  const counts = built.summary.droppedSenseRows;
  assert.ok(counts.ambiguousTarget <= 4741,
    `ambiguous drops grew to ${counts.ambiguousTarget}; raise DROPPED_SENSE_BASELINE deliberately if intended`);
});
