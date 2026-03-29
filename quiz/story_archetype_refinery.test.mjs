import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const filename = path.join(repoRoot, "examples", "pyash", "refinery-story-deep-research-report-run.pya");

test("story archetype refinery includes one verifier call in reusable stage ceremony", () => {
  const text = fs.readFileSync(filename, "utf8");
  assert.match(text, /su name stage hook run from text stage name with text stage role to name text stage hooks out be ceremony def/u);
  assert.match(text, /for name archetype hook verifier mind/u);
});

test("story archetype refinery runs all seven archetype stages", () => {
  const text = fs.readFileSync(filename, "utf8");
  assert.match(text, /from text "seed"/u);
  assert.match(text, /from text "awake"/u);
  assert.match(text, /from text "challenge"/u);
  assert.match(text, /from text "experience"/u);
  assert.match(text, /from text "integrated self"/u);
  assert.match(text, /from text "transformation"/u);
  assert.match(text, /from text "highway"/u);
});
