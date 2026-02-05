import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parse } from "../program/understand/parse_tokens.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(text, { env } = {}) {
  const prevEnv = { ...process.env };
  if (env) Object.assign(process.env, env);
  try {
    const sentence = parse(text);
    return await interpret(sentence);
  } finally {
    process.env = prevEnv;
  }
}

test("compile photograph to text writes output", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  await run("from filename \"./module/compile_photograph_text.pya\" ob name compile to name compile be import do");
  await run("from filename \"./module/see_vl.pya\" ob name see to name see be import do");
  const outputFile = "quiz/sandpit/compile-photograph.txt";
  await run(
    `from filename "quiz/fixtures/pyash_raven.png" fromstate wo photograph become wo text to filename "${outputFile}" be compile do`,
    { env: { PYA_SEE_VL_FIXTURE: "fixture description" } }
  );
  const written = await fs.readFile(outputFile, "utf8");
  assert.equal(written, "fixture description");
});
