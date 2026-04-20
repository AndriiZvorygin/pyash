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

test("draw from filename with style text registers auto-output signature", async () => {
  forget();
  await interpret(parse('from filename "./module/draw_from_filename.pya" to name draw be import do'));

  const signature = joinSignatureWords(
    deriveSignatureFromCall(parse('su name demo from filename "quiz/fixtures/ramblings.txt" with text "watercolor editorial" be draw from do'))
  );
  const resolved = lookupSignature(signature);
  assert.ok(resolved, `missing signature: ${signature}`);
});

test("draw thumbnail from filename module registers auto-output signature", async () => {
  forget();
  await interpret(parse('from filename "./module/draw_from_filename.pya" to name draw as wo thumbnail be import do'));

  const signature = joinSignatureWords(
    deriveSignatureFromCall(parse('su name demo from filename "quiz/fixtures/ramblings.txt" be draw as wo thumbnail do'))
  );
  const resolved = lookupSignature(signature);
  assert.ok(resolved, `missing signature: ${signature}`);
});

test("draw thumbnail from filename with style text registers auto-output signature", async () => {
  forget();
  await interpret(parse('from filename "./module/draw_from_filename.pya" to name draw as wo thumbnail be import do'));

  const signature = joinSignatureWords(
    deriveSignatureFromCall(parse('su name demo from filename "quiz/fixtures/ramblings.txt" with text "1960s editorial" be draw as wo thumbnail do'))
  );
  const resolved = lookupSignature(signature);
  assert.ok(resolved, `missing signature: ${signature}`);
});

test("draw from filename module writes artifacts and know produce outputs", async () => {
  const text = await fs.readFile("module/draw_from_filename.pya", "utf8");
    assert.match(text, /Each line must be KEY: value using these keys in this exact order:/);
  assert.match(text, /HOOK_SUBJECT/);
  assert.match(text, /OVERLAY_TEXT/);
  assert.match(text, /Overlay text must be 2 to 5 words/);
  assert.match(text, /OVERLAY_TEXT should be words only, no decorative punctuation\./);
  assert.match(text, /One dominant focal subject only/);
  assert.match(text, /Default to exactly one human focal subject\./);
  assert.match(text, /Allow exactly two human subjects only if SOURCE_TEXT clearly demands two interacting people\./);
  assert.match(text, /Reserve one side as negative space for overlay text/);
  assert.match(text, /Describe only what SHOULD be present, never what should be absent./);
  assert.match(text, /Keep composition clean with minimal background detail./);
  assert.match(text, /Keep strong edge clarity and subject-background separation./);
  assert.match(text, /Avoid narrative full-sentence prose in schema values; use concise field phrases\./);
  assert.match(text, /Avoid decorative filler adjectives\./);
  assert.match(text, /ob text "artifacts\/" to name text artifacts dir path be text do/);
  assert.match(text, /ob name run id to name artifacts dir path be plus do/);
  assert.match(text, /ob text "know\/produce" to name text produce dir path be text do/);
  assert.match(text, /su name source read stage ob text of source read cmd to name text source text be command do/);
  assert.match(text, /for name mind to name text draw prompt schema by num 0 atmost num 280 be write do/);
  assert.match(text, /node command\/draw_comfyui_runner\.mjs --prompt-stdin/);
  assert.match(text, /draw thumbnail prompt system/);
  assert.match(text, /draw thumbnail prompt system template/);
  assert.match(text, /exists su name thumbnail variant mode ob text "single" be default ya/);
  assert.match(text, /exists su name thumbnail variant label ob text "" be default ya/);
  assert.match(text, /exists su name thumbnail generation policy be map def/);
  assert.match(text, /su name profile ob text "teaching_video" ya/);
  assert.match(text, /su name subject_policy ob text "human_face" ya/);
  assert.match(text, /su name face_required ob text "truth" ya/);
  assert.match(text, /su name text_prominence ob text "balanced" ya/);
  assert.match(text, /ob text " --profile-kind \\\"" to name draw compose cmd base be plus do/);
  assert.match(text, /ob text " --subject-policy \\\"" to name draw compose cmd base be plus do/);
  assert.match(text, /ob text " --face-required \\\"" to name draw compose cmd base be plus do/);
  assert.match(text, /ob text " --text-prominence \\\"" to name draw compose cmd base be plus do/);
  assert.match(text, /draw prompt system template/);
  assert.match(text, /draw prompt replacements be map def/);
  assert.match(text, /in name text draw prompt system template to name text draw prompt system be instead do/);
  assert.match(text, /Style hint: \[\[style_hint\]\]/);
  assert.match(text, /draw thumbnail prompt replacements be map def/);
  assert.match(text, /in name text draw thumbnail prompt system template to name text draw thumbnail prompt system be instead do/);
    assert.match(text, /ob text " --width "/);
  assert.match(text, /ob num of (width of draw size thumbnail|draw thumbnail width) to name draw cmd base be plus do/);
  assert.match(text, /ob text " --height "/);
  assert.match(text, /ob num of (height of draw size thumbnail|draw thumbnail height) to name draw cmd base be plus do/);
  assert.match(text, /ob name draw workflow default to name text workflow be text do/);
  assert.match(text, /ob name draw host to name text host be text do/);
  assert.match(text, /su name produce copy stage ob name text copy cmd be command do/);
  assert.match(text, /normalize_escaped_newlines\.mjs/);
  assert.match(text, /thumbnail_prompt_compose\.mjs/);
  assert.match(text, /be discharge as wo mind do/);
  assert.match(text, /draw_comfyui_runner\.mjs --prompt-stdin/);
  assert.match(text, /su name produce copy stage ob name text copy cmd be command do[\s\S]*?be discharge as wo draw do/);
});
