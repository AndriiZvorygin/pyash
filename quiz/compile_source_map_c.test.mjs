import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile c emits #line directives for pyash source", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-srcmap-"));
  const sourcePath = path.join(tmpDir, "program.pya");
  await fs.writeFile(sourcePath, "exists su name alpha ob num 1 be number ya\nexists su name beta ob num 2 be number ya\n", "utf8");

  const sentence = parse(`from filename "${sourcePath}" to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  assert.ok(c.includes(`#line 1 "${sourcePath}"`));
  assert.ok(c.includes(`#line 2 "${sourcePath}"`));
});
