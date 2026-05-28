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
    'su name demo from text "Hook line. Body line. CTA line." with text "1960s editorial illustration" be teaching video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" be teaching video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" with text "1960s editorial illustration" be teaching video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to filename "artifacts/video/test.mp4" be teaching video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" with text "1960s editorial illustration" to filename "artifacts/video/test.mp4" be teaching video do'
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
    'su name demo from ve name hear platform name concatenate platform fromstate wo srt with name concatenate platform to filename "artifacts/video/test-footnote.mp4" as wo wordflow become wo video be footnote do',
    'su name demo from filename "artifacts/video/test.srt" fromstate wo srt with filename "artifacts/video/test.mp4" become wo video to filename "artifacts/video/test-footnote.mp4" as wo wordflow by num 0.4 be footnote do'
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
  const source = await fs.readFile("module/video_common.pya", "utf8");
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
  const source = await fs.readFile("module/video_common.pya", "utf8");
  assert.match(
    source,
    /su name draw size widescreen be map def[\s\S]*subtitle_margin_ratio ob num 0\.10[\s\S]*footnote_mode ob text "karaoke"/u
  );
});

test("current footnote mode resolves widescreen karaoke and tall wordflow", async () => {
  const source = await fs.readFile("module/video_common.pya", "utf8");
  assert.match(
    source,
    /su name current footnote mode[\s\S]*draw widescreen mode be equally from text "truth" then[\s\S]*footnote_mode of draw size widescreen[\s\S]*draw widescreen mode be equally from text "lie" then[\s\S]*footnote_mode of draw size shorts/u
  );
});

test("wide teaching flow forces karaoke at footnote burn call sites", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /draw widescreen mode be equally from text "truth" then su name footnote output stage[\s\S]*as text "karaoke" be footnote mode do/u
  );
  assert.match(
    source,
    /draw widescreen mode be equally from text "truth" then su name section clip output stage[\s\S]*as text "karaoke" be footnote mode do/u
  );
  assert.match(
    source,
    /ob text of subtitle_mode to name text subtitle mode chosen be text do[\s\S]*subtitle mode chosen be equally from text "karaoke" then ob text "karaoke" to name text footnote mode current be text do/u
  );
});

test("regular explicit asr branch stays available and regular explicit karaoke skips asr branch", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /subtitle mode chosen be equally from text "asr" then su name section hear stage[\s\S]*be hear do/u
  );
  assert.match(
    source,
    /subtitle mode chosen be equally from text "karaoke" then ob text "node\$\{IFS\}command\/srt_from_qwen_say_chunks\.mjs\$\{IFS\}"/u
  );
  assert.match(
    source,
    /teaching video from text manuscript be ceremony def[\s\S]*subtitle mode chosen be equally from text "karaoke" then su name footnote mode override ob text "karaoke" ya/u
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

test("footnote mode helper centralizes mode branch selection", async () => {
  const source = await fs.readFile("module/video_common.pya", "utf8");
  assert.match(
    source,
    /su name footnote mode from filename captions with filename video to filename output by num subtitle margin as text mode be ceremony def/u
  );
  assert.match(
    source,
    /ob name text footnote mode chosen be equally from text "karaoke" then su name footnote stage/u
  );
  assert.match(
    source,
    /ob name text footnote mode chosen be equally from text "wordflow" then su name footnote stage/u
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
  assert.match(
    source,
    /su name teaching video stage manifest filename[\s\S]*ob name text stage stem to name text stage manifest stem be text do[\s\S]*ob text "\.series\.pya" to name stage manifest stem be plus do/u
  );
});

test("teaching video thumbnail comes from section draw output (no extra thumbnail mind prompt)", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /section video series stage[\s\S]*thumbnail section root stage[\s\S]*\/draw\/section-draw-stage-cut-001\.png[\s\S]*thumbnail heading stage/u
  );
  assert.doesNotMatch(
    source,
    /teaching video from text manuscript[\s\S]*brief video internal thumbnail mind/u
  );
});

test("section mappers use section-local aligned srt timing for cuts and footnotes", async () => {
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
    /teaching video section align mapper[\s\S]*with text "captions-source\.txt" to name filename section source text be teaching video section leaf do[\s\S]*with text "captions-aligned\.srt" to name filename section aligned srt be teaching video section leaf do[\s\S]*node command\/lyrics_to_srt_from_timing\.mjs[\s\S]*--sentence-cues/u
  );
  assert.match(
    source,
    /teaching video section video mapper[\s\S]*ob filename of ob of this to name filename section aligned srt input be filename do[\s\S]*from filename of ob of section aligned srt input stage to name itinerary section cuts itinerary be cut do/u
  );
  assert.match(
    source,
    /section align series stage from name teaching sections by name teaching video section align mapper to name text teaching section aligned srts be series map do[\s\S]*section cut series stage from name teaching section aligned srts by name teaching video section video mapper/u
  );
  assert.match(
    source,
    /teaching video section footnote mapper[\s\S]*with text "captions-aligned\.srt" to name filename section aligned srt be teaching video section leaf do[\s\S]*from filename of ob of section aligned srt stage with filename of ob of section footnote video input stage to filename of ob of section footnote clip stage[\s\S]*be footnote mode do/u
  );
  assert.match(
    source,
    /section clip series stage from name teaching sections by name teaching video section footnote mapper/u
  );
  assert.match(
    source,
    /su name teaching video section leaf from num section index with text leaf to name filename section file be ceremony def/u
  );
});

test("teaching video options map defaults image cadence to sentence", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /exists su name teaching video options be map def[\s\S]*su name image_cadence ob text "sentence" ya/u
  );
});

test("section prompt and concatenate mappers share image cadence selection", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    source,
    /teaching video section prompt mapper[\s\S]*section image cadence stage ob text of image_cadence of teaching video options[\s\S]*section image cadence stage be equally from text "" then ob text "phrase"[\s\S]*section image cadence stage be equally from text "phrase" then ob text "node command\/itinerary_split_phrases\.mjs[\s\S]*section selected cuts stage ob filename of ob of section cuts input stage[\s\S]*section image cadence stage be equally from text "phrase" then su name section selected cuts stage ob filename of ob of section phrase cuts stage[\s\S]*section cuts itinerary stage ob name filename section selected cuts stage/u
  );
  assert.match(
    source,
    /teaching video section concatenate mapper[\s\S]*section image cadence stage ob text of image_cadence of teaching video options[\s\S]*section image cadence stage be equally from text "" then ob text "phrase"[\s\S]*section selected cuts stage ob filename of ob of section cuts input stage[\s\S]*section image cadence stage be equally from text "phrase" then su name section selected cuts stage ob filename of ob of section phrase cuts stage[\s\S]*section cuts itinerary stage ob name filename section selected cuts stage/u
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

test("draw promptify instruction anchors literal named subjects, especially humans", async () => {
  const briefSource = await fs.readFile("module/brief_video.pya", "utf8");
  const musicSource = await fs.readFile("module/music_video.pya", "utf8");
  assert.match(
    briefSource,
    /If current_cut names a specific person, people, species, object, place, or era, depict that exact entity\./u
  );
  assert.match(
    briefSource,
    /If people are visible, sentence three must include concrete appropriate clothing worn by visible people; keep clothing description non-sexual and suitable for mainstream platforms\./u
  );
  assert.match(
    musicSource,
    /If current_cut names a specific person, people, species, animal, object, place, or era, depict that literal subject\./u
  );
});


test("default wide subtitle mode is karaoke and non-ASR path is available", async () => {
  const source = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(source, /ob name text subtitle mode chosen be equally from text "" then ob text "karaoke" to name text subtitle mode chosen be text do/u);
  assert.match(source, /subtitle mode chosen be equally from text "asr" then su name section hear stage/u);
  assert.match(source, /subtitle mode chosen be equally from text "karaoke" then su name section timing stage ob name text section timing cmd be command do/u);
});
