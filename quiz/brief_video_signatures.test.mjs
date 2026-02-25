import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler } from "../program/bridge/signature.mjs";

test("brief video module registers filename signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_video.pya" to name brief video be import do'));

  const calls = [
    'su name demo from filename "quiz/fixtures/ramblings.txt" be brief video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to filename "artifacts/video/test.mp4" be brief video do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
    assert.ok(String(resolved).endsWith("brief video"), `unexpected target: ${resolved}`);
  }
});

test("teaching video module registers text and filename signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_video.pya" to name teaching video be import do'));

  const calls = [
    'su name demo from text "Hook line. Body line. CTA line." be teaching video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" be teaching video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to filename "artifacts/video/test.mp4" be teaching video do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
    assert.ok(String(resolved).endsWith("teaching video"), `unexpected target: ${resolved}`);
  }
});

test("teaching video verbs accept vector dependency forms", async () => {
  forget();
  await interpret(parse('su name init ob text "ready" be write do'));

  const lines = [
    'su name demo from ve name itinerary teaching cuts name photographs photos fromstate wo itinerary become wo video to filename "artifacts/video/test.mp4" be concatenate do',
    'su name demo from ve name hear platform name concatenate platform fromstate wo srt with name concatenate platform to filename "artifacts/video/test-footnote.mp4" as wo wordflow become wo video be footnote do'
  ];

  for (const line of lines) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const handler = lookupSignatureHandler(signature);
    assert.equal(typeof handler, "function", `missing signature handler: ${signature}`);
  }
});

test("teaching video pipeline burns heading into opening second", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /su name opening heading stage[\s\S]*be video heading burn do/u
  );
});

test("widescreen mode selects one ratio set without summing", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /su name current thumbnail heading y ratio[\s\S]*draw widescreen mode be equally from text "truth"[\s\S]*draw size widescreen[\s\S]*draw widescreen mode be equally from text "lie"[\s\S]*draw size shorts/u
  );
  assert.match(
    source,
    /su name current video heading y ratio[\s\S]*draw widescreen mode be equally from text "truth"[\s\S]*draw size widescreen[\s\S]*draw widescreen mode be equally from text "lie"[\s\S]*draw size shorts/u
  );
  assert.match(
    source,
    /su name current subtitle margin ratio[\s\S]*draw widescreen mode be equally from text "truth"[\s\S]*draw size widescreen[\s\S]*draw widescreen mode be equally from text "lie"[\s\S]*draw size shorts/u
  );
});

test("widescreen defaults keep karaoke subtitles near bottom", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /su name draw size widescreen be map def[\s\S]*subtitle_margin_ratio ob num 0\.10[\s\S]*footnote_mode ob text "karaoke"/u
  );
});

test("current footnote mode resolves widescreen karaoke and tall wordflow", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /su name current footnote mode[\s\S]*ob text "wordflow"[\s\S]*draw widescreen mode be equally from text "truth" then[\s\S]*ob text "karaoke"/u
  );
});

test("layout helpers expose widescreen karaoke and shorts wordflow map values", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_video.pya" to name brief video be import do'));

  const wideMode = await interpret(parse("su name first to name text widescreen footnote mode be widescreen footnote mode do"));
  const wideMargin = await interpret(parse("su name second to name num widescreen subtitle margin ratio be widescreen subtitle margin ratio do"));
  const tallMode = await interpret(parse("su name third to name text shorts footnote mode be shorts footnote mode do"));
  const tallMargin = await interpret(parse("su name fourth to name num shorts subtitle margin ratio be shorts subtitle margin ratio do"));

  assert.equal(String(wideMode?.result?.text), "karaoke");
  assert.equal(Number(wideMargin?.result?.num), 0.1);
  assert.equal(String(tallMode?.result?.text), "wordflow");
  assert.equal(Number(tallMargin?.result?.num), 0.1);
});

test("footnote branch compares direct stage text value", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /ob text of ob of footnote mode stage be equally from text "karaoke"/u
  );
  assert.match(
    source,
    /ob text of ob of footnote mode stage be equally from text "wordflow"/u
  );
});

test("teaching video branch conditions stay single-line to avoid double execution", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.doesNotMatch(
    source,
    /be equally from text "karaoke" then\s*\n\s*su name (?:footnote|section footnote) platform/u
  );
  assert.doesNotMatch(
    source,
    /be equally from text "" then\s*\n\s*ob text "manual"/u
  );
});

test("teaching video writes footnote stage manifest and scrubs missing footnote clips", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /from text "teaching-section-clips-footnote" to name filename section clip manifest be teaching video stage manifest filename do/u
  );
  assert.match(
    source,
    /\/teaching-section-clips-footnote\.series\.pya" to name section clip manifest path be plus do/u
  );
  assert.match(
    source,
    /ob text "; fi" to name section clip scrub command be plus do/u
  );
  assert.match(
    source,
    /ob name text section clip scrub command be command do/u
  );
  assert.match(
    source,
    /ob name section clip series stage to filename of ob of section clip manifest filename stage be write do/u
  );
});

test("section mappers normalize current item to filename before media verbs", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /teaching video section tell mapper[\s\S]*ob filename of ob of section audio stage be filename do/u
  );
  assert.match(
    source,
    /teaching video section hear mapper[\s\S]*ob filename of ob of this to name filename section audio input be filename do[\s\S]*from filename of ob of section audio input stage become wo srt/u
  );
  assert.match(
    source,
    /teaching video section video mapper[\s\S]*ob filename of ob of this to name filename section srt input be filename do[\s\S]*from filename of ob of section srt input stage during/u
  );
  assert.match(
    source,
    /teaching video section footnote mapper[\s\S]*ob filename of ob of this to name filename section video input be filename do[\s\S]*with filename of ob of section video input stage become wo video/u
  );
});

test("qwen tone promptify instruction enforces single-line style with example output", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /exists su name qwen say tone promptify instruction ob text quoted\.text\.Return exactly one single-line speaking direction sentence for TTS\./u
  );
  assert.match(
    source,
    /Example output \(single line\):[\s\S]*Warm friendly teacher, moderate pace, crisp articulation, brief pauses after key terms, gentle emphasis\./u
  );
});
