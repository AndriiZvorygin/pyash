import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("better compare hymn from filename keeps draft artifacts and writes winner copies", async () => {
  const text = await fs.readFile("examples/pyash/better-compare-hymn-manuscript-from-filename.pya", "utf8");

  assert.match(text, /exists su name hymn draft count ob num 0 be number ya/);
  assert.match(text, /ob text "artifacts\/" to name text hymn artifacts dir be text do/);
  assert.match(text, /ob text "\/candidates" to name hymn candidates dir be plus do/);
  assert.match(text, /ob text "know\/produce" to name text hymn produce dir be text do/);
  assert.match(text, /ob num 1 to name hymn draft count be plus do/);
  assert.match(text, /ob text of ob of hymn draft count to name text hymn draft count text be text do/);
  assert.match(text, /ob text "\/hymn-draft-" to name hymn draft path be plus do/);
  assert.match(text, /ob text "\.txt" to name hymn draft path be plus do/);
  assert.match(text, /su name hymn draft artifact stage ob name text manuscript out to filename of ob of hymn draft filename stage be write do/);
  assert.match(text, /ob text "\/produce\.txt" to name produce path be plus do/);
  assert.match(text, /su name hymn produce stage ob name text hymn final to filename of ob of produce filename stage be write do/);
  assert.match(text, /ob name hymn stem safe stage to name hymn produce copy path be plus do/);
  assert.match(text, /su name hymn produce copy stage ob name text hymn final to filename of ob of hymn produce copy filename stage be write do/);
});
