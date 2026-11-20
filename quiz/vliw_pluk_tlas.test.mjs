import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "examples/pyash/vliw-pluk-tlas.pya"), "utf8");
const loweredProgram = source
  .split(/\n/u)
  .filter((line) => line.trim())
  .flatMap((line) => lowerSentence(parse(line)));

test("pluk tlas lowers its typed named-vector evaluation signature without JS scoring", () => {
  const lowered = loweredProgram[2];

  assert.equal(lowered.semantic, "pluk-tlas");
  assert.deepEqual(Array.from(lowered.words.slice(0, 15)), [
    0x4909,
    0x225e,
    0x68b1,
    0x245e,
    0x225e,
    0x327e,
    0x225e,
    0xaa90,
    0x243e,
    0x225e,
    0x4930,
    0x287e,
    0x2a64,
    0x896a,
    0x295e
  ]);
});

test("pluk tlas requires named vector references and a num output", () => {
  assert.throws(
    () => lowerSentence(parse("ob ve float32 1 by name answer to name num count be pluk tlas do")),
    (error) => error.code === "unsupported-sentence"
  );
  assert.throws(
    () => lowerSentence(parse("ob name prediction by name answer to name text count be pluk tlas do")),
    (error) => error.code === "unsupported-sentence"
  );
});
