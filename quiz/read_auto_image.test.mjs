import test from "node:test";
import assert from "node:assert/strict";
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

test("read_auto routes image to see with text output", async () => {
  forget();
  await run("from filename \"./module/read_auto.pya\" ob name read to name read be import do");
  await run("from filename \"./module/see_vl.pya\" ob name see to name see be import do");
  const result = await run(
    "from filename \"quiz/fixtures/pyash_raven.png\" become wo text to name text out be read do",
    { env: { PYA_SEE_VL_FIXTURE: "fixture description" } }
  );
  assert.equal(result?.result?.text, "fixture description");
});
