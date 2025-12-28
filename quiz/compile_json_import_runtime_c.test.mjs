import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

const execFileAsync = promisify(execFile);

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile runtime json import to C matches interpreter map defs", async () => {
  forget();

  const json = JSON.stringify({
    name: "Ada",
    pets: [{ kind: "cat" }, { kind: "dog" }],
    tags: [true, false]
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-json-import-"));
  const interpOut = path.join(tmpDir, "interp.txt");
  const cOut = path.join(tmpDir, "c.txt");

  const interpreterLines = [
    `ob text ${JSON.stringify(json)} to name profile be import do`,
    `ob name profile be write to filename "${interpOut}" do`
  ];
  for (const line of interpreterLines) {
    await interpret(parse(line));
  }
  const expected = await fs.readFile(interpOut, "utf8");

  const compiledLines = [
    `ob text ${JSON.stringify(json)} to name profile be import do`,
    `ob name profile be write to filename "${cOut}" do`
  ];
  const program = compiledLines.join("\n");
  const sentence = parse(`from text quoted.pyash.${program}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"], { timeout: 120000 });
  await execFileAsync(exePath, [], { timeout: 120000 });

  const actual = await fs.readFile(cOut, "utf8");
  assert.equal(actual.trim(), expected.trim());
});
