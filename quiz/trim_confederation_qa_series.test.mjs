import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("trim confederation qa series drops head preface and tail signoff", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pya-trim-confed-"));
  const inputPath = path.join(tmpDir, "in.series.pya");
  const outputPath = path.join(tmpDir, "out.series.pya");
  const source = [
    "su name confederation wise chips be series def",
    "ob text quoted.text.Topics: Opening matter..text.quoted be text ya",
    "ob text quoted.text.#### Q’uo\n\nInvocation words.\n.text.quoted be text ya",
    "ob text quoted.text.#### M\n\nQuestion one?\n\n#### Q’uo\n\nAnswer one.\n\n#### M\n\nNo Q’uo, thank you.\n\n#### Q’uo\n\nI am Q’uo, and we thank you, my sister. Is there another query at this time?\n.text.quoted be text ya",
    "ob text quoted.text.#### G\n\nQuestion two?\n\n#### Q’uo\n\nAnswer two.\n\n\\[Pause\\]\n\nI am Q’uo, and we thank each of you for blending your energies.\n.text.quoted be text ya",
    "prah",
    ""
  ].join("\n");
  await fs.writeFile(inputPath, source, "utf8");

  const proc = spawnSync("node", ["command/trim_confederation_qa_series.mjs", inputPath, outputPath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(proc.status, 0, proc.stderr);
  const out = await fs.readFile(outputPath, "utf8");
  assert.ok(!out.includes("Topics: Opening matter."));
  assert.ok(!out.includes("Invocation words."));
  assert.ok(out.includes("#### M"));
  assert.ok(out.includes("#### G"));
  assert.ok(!out.includes("Is there another query at this time?"));
  assert.ok(!out.includes("I am Q’uo, and we thank each of you"));
  assert.ok(!out.includes("\\[Pause\\]"));
});
