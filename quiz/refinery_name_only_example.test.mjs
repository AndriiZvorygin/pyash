import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("name-only shorts refinery keeps prompt+footnote stages and no filename tokens", async () => {
  const file = path.join(process.cwd(), "examples", "pyash", "refinery-love-teaching-shorts-name-only.pya");
  const text = await fs.readFile(file, "utf8");
  assert.doesNotMatch(text, /\bfilename\b/u);
  assert.match(text, /su name prompt stage/u);
  assert.match(text, /be promptify do/u);
  assert.match(text, /su name footnote platform/u);
});
