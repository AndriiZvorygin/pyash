import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("mind generate retries once when backend returns load done_reason with empty content", async () => {
  forget();
  const originalMock = process.env.PYA_MIND_RESPONSE;
  if (originalMock !== undefined) delete process.env.PYA_MIND_RESPONSE;

  try {
    await run("exists su name provider auto discharge ob bool lie be default ya");
    await run("exists su name retry count ob num 0 be number ya");
    await run("su name retry backend ob text payload be ceremony def");
    await run("ob num 1 to name retry count be plus do");
    await run("su name retry count from num 1 be equally then ob text quoted.text.{\"done_reason\":\"load\",\"message\":{\"content\":\"\"}}.text.quoted ret");
    await run("ob text quoted.text.{\"message\":{\"content\":\"Solon Freed Athens\"}}.text.quoted ret");
    await run("prah");
    await run("exists su name mind backend ob name retry backend be default ya");
    await run("exists su name mind model ob text \"retry-test-model\" be default ya");
    await run("exists su name helper be mind via state \"retry-test-model\" ya");

    const result = await run("ob text \"title please\" for name helper to name text out be write do");
    const text = String(result?.ob?.text ?? result?.value?.text ?? result?.result?.text ?? "");
    assert.equal(text, "Solon Freed Athens");
  } finally {
    if (originalMock === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMock;
  }
});
