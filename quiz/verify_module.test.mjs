import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("verify module routes text input through verify mind brief", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "PASS";
  try {
    forget();
    await run("from name ./module/verify.pya to name verify be import do");
    await run('exists su name verify brief prompter ob text "Verify." be text ya');
    await run('exists su name verify mind brief be mind as name "qwen3-vl:8b-instruct" fromtext name verify brief prompter ya');
    await run('su name check ob text "Task." to name text verify-out be verify do');
    assert.equal(remember("verify-out")?.ob?.text, "PASS");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("verify module supports with wo tools for text input", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "PASS";
  try {
    forget();
    await run("from name ./module/verify.pya to name verify be import do");
    await run('exists su name verify brief prompter ob text "Verify." be text ya');
    await run('exists su name verify mind brief be mind as name "qwen3-vl:8b-instruct" fromtext name verify brief prompter ya');
    await run('ob text "Task." to name text verify-out with wo tools be verify do');
    assert.equal(remember("verify-out")?.ob?.text, "PASS");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("verify module supports explicit for name mind target", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "PASS";
  try {
    forget();
    await run("from name ./module/verify.pya to name verify be import do");
    await run('exists su name helper be mind as name "qwen3-vl:8b-instruct" fromtext text "Verify." ya');
    await run('su name check ob text "Task." for name mind helper to name text verify-out be verify do');
    assert.equal(remember("verify-out")?.ob?.text, "PASS");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("verify module supports explicit for name mind target with wo tools", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "PASS";
  try {
    forget();
    await run("from name ./module/verify.pya to name verify be import do");
    await run('exists su name helper be mind as name "qwen3-vl:8b-instruct" fromtext text "Verify." ya');
    await run('su name check ob text "Task." for name mind helper to name text verify-out with wo tools be verify do');
    assert.equal(remember("verify-out")?.ob?.text, "PASS");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
