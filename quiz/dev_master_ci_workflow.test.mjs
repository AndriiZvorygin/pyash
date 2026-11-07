import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");

test("GitHub CI has focused checks only and no scheduled full-suite run", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.doesNotMatch(workflow, /^\s+schedule:\s*$/mu);
  assert.match(workflow, /name: Focused checks \(master\)/u);
  assert.doesNotMatch(workflow, /run: npm run test:ci(?:\s|$)/u);
});

test("GitHub CI does not launch an automatic Codex failure analyzer", () => {
  const analysisWorkflow = path.join(repoRoot, ".github", "workflows", "ci-failure-analysis.yml");
  assert.equal(fs.existsSync(analysisWorkflow), false);
});
