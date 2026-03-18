import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

test("draw from filename module registers auto-output signature", async () => {
  forget();
  await interpret(parse('from filename "./module/draw_from_filename.pya" to name draw be import do'));

  const signature = joinSignatureWords(
    deriveSignatureFromCall(parse('su name demo from filename "quiz/fixtures/ramblings.txt" be draw from do'))
  );
  const resolved = lookupSignature(signature);
  assert.ok(resolved, `missing signature: ${signature}`);
});

test("draw from filename module writes artifacts and know produce outputs", async () => {
  const text = await fs.readFile("module/draw_from_filename.pya", "utf8");
  assert.match(text, /Include exactly one quoted overlay phrase of 1 to 3 words/);
  assert.match(text, /Keep overlay text brief and highly readable like a thumbnail/);
  assert.match(text, /ob text "artifacts\/" to name text artifacts dir path be text do/);
  assert.match(text, /ob name run id to name artifacts dir path be plus do/);
  assert.match(text, /ob text "know\/produce" to name text produce dir path be text do/);
  assert.match(text, /su name source read stage ob text of source read cmd to name text source text be command do/);
  assert.match(text, /for name mind to name text draw prompt by num 0 atmost num 140 be write do/);
  assert.match(text, /node command\/draw_comfyui_runner\.mjs --prompt-stdin/);
  assert.match(text, /ob name draw workflow default to name text workflow be text do/);
  assert.match(text, /ob name draw host to name text host be text do/);
  assert.match(text, /su name produce copy stage ob name text copy cmd be command do/);
  assert.match(
    text,
    /normalize_escaped_newlines\.mjs[\s\S]*?be discharge as wo mind do[\s\S]*?draw_comfyui_runner\.mjs/
  );
  assert.match(text, /su name produce copy stage ob name text copy cmd be command do[\s\S]*?be discharge as wo draw do/);
});
