import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScript } from "./helpers/run_script.mjs";

const repoRoot = path.join(process.cwd());
const moduleFilename = path.join(repoRoot, "module", "module_manuscript_bible.pya");
const wrapperFilename = path.join(repoRoot, "examples", "pyash", "refinery-module-manuscript-bible-run.pya");

function assertNoUnexpectedErrors(errors = []) {
  const unexpected = errors.filter((line) => {
    const text = String(line);
    return !text.startsWith("artifacts folder: ")
      && !text.startsWith("run start: ")
      && !text.startsWith("run end: ")
      && !text.startsWith("run duration: ");
  });
  assert.deepEqual(unexpected, []);
}

test("module manuscript bible module parses through the real trace reader", async () => {
  const { errors } = await runScript("command/read_pya_trace.mjs", ["module/module_manuscript_bible.pya"]);
  assertNoUnexpectedErrors(errors);
});

test("module manuscript bible module stays importable from another pya file", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "module-manuscript-bible-import-"));
  const importerFilename = path.join(tempRoot, "import_module_manuscript_bible.pya");
  const importLine = `from filename "${moduleFilename}" ob name manuscript as wo module to name manuscript as wo module be import do\n`;

  await fs.writeFile(importerFilename, importLine, "utf8");
  const { errors } = await runScript("command/read_pya_trace.mjs", [importerFilename]);
  assertNoUnexpectedErrors(errors);
});

test("module manuscript bible wrapper points to bible module path", async () => {
  const wrapperSource = await fs.readFile(wrapperFilename, "utf8");
  assert.match(wrapperSource, /module_manuscript_bible\.pya/u);
});

test("module manuscript bible requires citation only in segment 1 2 3 prompts and checks", async () => {
  const moduleSource = await fs.readFile(moduleFilename, "utf8");

  assert.match(moduleSource, /Include exactly one relevant Bible citation in parentheses, like \(John 3:16\)\./u);
  assert.match(moduleSource, /directly support the segment's main definition or mechanism/u);
  assert.match(moduleSource, /directly support the misunderstanding-plus-clarification move/u);
  assert.match(moduleSource, /directly support the consequence or lived-application move/u);
  assert.match(moduleSource, /Prefer a different citation from Segment 1 when the source supports multiple fitting options/u);
  assert.match(moduleSource, /Prefer a different citation from Segment 1 and Segment 2 when the source supports multiple fitting options/u);

  const mustMatchCount = (moduleSource.match(/su name must_match_pattern ob text "\\\\\([^\n]+\\\)"/gu) ?? []).length;
  assert.equal(mustMatchCount, 6);

  assert.match(moduleSource, /module manuscript segment one checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.match(moduleSource, /module manuscript segment one platform checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.match(moduleSource, /module manuscript segment two checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.match(moduleSource, /module manuscript segment two platform checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.match(moduleSource, /module manuscript segment three checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.match(moduleSource, /module manuscript segment three platform checks be series def[\s\S]{0,240}must_match_pattern/u);

  assert.doesNotMatch(moduleSource, /module manuscript hook checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.doesNotMatch(moduleSource, /module manuscript promise checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.doesNotMatch(moduleSource, /module manuscript roadmap checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.doesNotMatch(moduleSource, /module manuscript recap checks be series def[\s\S]{0,240}must_match_pattern/u);
  assert.doesNotMatch(moduleSource, /module manuscript cta checks be series def[\s\S]{0,240}must_match_pattern/u);
});
