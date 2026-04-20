import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runLyricsToSrt } from "../command/lyrics_to_srt_from_timing.mjs";

function parseSrtRows(text) {
  const blocks = String(text ?? "").trim().split(/\n\s*\n/u).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const timeLine = lines[1] ?? "";
    const m = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/u.exec(timeLine);
    if (!m) return null;
    const since = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const until = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    return { since, until, text: (lines[2] ?? "").trim() };
  }).filter(Boolean);
}

test("lyrics_to_srt_from_timing keeps repeated chorus lines distributed across timeline", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-repeat.txt");
  const timingPath = path.join(dir, "timing-repeat.srt");
  const outputPath = path.join(dir, "lyrics-repeat.out.srt");

  const lyrics = [
    "Go forth in your armor of light",
    "We polish armor until the light shines bright and clear.",
    "Go forth in your armor of light",
    "Steel shields reflect the morning's golden rays today.",
    "Go forth in your armor of light",
    "Ride forth with truth and compassion"
  ].join("\n");

  const timing = [
    "1",
    "00:00:00,000 --> 00:00:03,000",
    "go forth in your armor of light",
    "",
    "2",
    "00:00:06,000 --> 00:00:10,000",
    "we polish armor until the light shines bright and clear",
    "",
    "3",
    "00:00:12,000 --> 00:00:15,000",
    "go forth in your armor of light",
    "",
    "4",
    "00:00:26,000 --> 00:00:30,000",
    "steel shields reflect the morning's golden rays today",
    "",
    "5",
    "00:00:32,000 --> 00:00:36,000",
    "go forth in your armor of light ride forth with truth and compassion"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath]);

  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.equal(rows.length, 6);
  assert.ok(rows[0].since < 2, "first line should stay near start");
  assert.ok(rows[rows.length - 1].until > 34, "last line should stay near end");

  let tinyTailRows = 0;
  for (const row of rows) {
    if (row.since >= 30 && row.until <= 36.5) tinyTailRows += 1;
  }
  assert.ok(tinyTailRows <= 3, "rows should not collapse to song tail window");
});

test("lyrics_to_srt_from_timing fails fast on obvious lyrics mismatch", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-mismatch.txt");
  const timingPath = path.join(dir, "timing-mismatch.srt");
  const outputPath = path.join(dir, "lyrics-mismatch.out.srt");

  const lyrics = [
    "quantum pineapple zephyr",
    "crystalline marsupial echo",
    "nebula toaster lattice"
  ].join("\n");

  const timing = [
    "1",
    "00:00:00,000 --> 00:00:03,000",
    "go forth in your armor of light",
    "",
    "2",
    "00:00:03,000 --> 00:00:06,000",
    "ride forth with truth and compassion"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  process.env.PYA_SRT_ALLOW_MISMATCH_FALLBACK = "false";
  try {
    await assert.rejects(
      () => runLyricsToSrt([lyricsPath, timingPath, outputPath]),
      /lyrics mismatch/u
    );
  } finally {
    delete process.env.PYA_SRT_ALLOW_MISMATCH_FALLBACK;
  }
});

test("lyrics_to_srt_from_timing avoids chorus freeze from overly wide repeated-token matches", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-chorus-freeze.txt");
  const timingPath = path.join(dir, "timing-chorus-freeze.srt");
  const outputPath = path.join(dir, "lyrics-chorus-freeze.out.srt");

  const lyrics = [
    "Polish the armor of light",
    "We find the love hiding inside us all.",
    "Polish the armor of light"
  ].join("\n");

  const timing = [
    "1",
    "00:00:36,000 --> 00:00:36,560",
    "Polish",
    "",
    "2",
    "00:00:36,640 --> 00:00:36,680",
    "the",
    "",
    "3",
    "00:00:36,960 --> 00:00:38,240",
    "armor of",
    "",
    "4",
    "00:00:41,920 --> 00:00:44,400",
    "We find the love hiding",
    "",
    "5",
    "00:00:44,401 --> 00:00:48,400",
    "inside us all",
    "",
    "6",
    "00:00:48,800 --> 00:00:49,280",
    "Polish",
    "",
    "7",
    "00:00:49,440 --> 00:00:49,480",
    "the",
    "",
    "8",
    "00:00:49,680 --> 00:00:50,880",
    "armor",
    "",
    "9",
    "00:00:51,081 --> 00:00:54,400",
    "light"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath]);

  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.equal(rows.length, 3);
  const firstDur = rows[0].until - rows[0].since;
  assert.ok(firstDur < 10, `first chorus line should not freeze, got ${firstDur.toFixed(3)}s`);
});

test("lyrics_to_srt_from_timing keeps repeated dense chorus windows bounded", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-dense-chorus.txt");
  const timingPath = path.join(dir, "timing-dense-chorus.srt");
  const outputPath = path.join(dir, "lyrics-dense-chorus.out.srt");

  const lyrics = [
    "Polish the armor of light",
    "We polish the armor of light each day,",
    "To find the love hiding inside us all.",
    "Our hearts open wide and let fear fade away,",
    "Riding forward with joy toward the truth.",
    "Polish the armor of light",
    "We find the love hiding inside us all.",
    "Polish the armor of light"
  ].join("\n");

  const timing = [
    "1",
    "00:00:04,720 --> 00:00:10,960",
    "polish",
    "",
    "2",
    "00:00:10,961 --> 00:00:13,120",
    "the armor of light",
    "",
    "3",
    "00:00:13,600 --> 00:00:21,280",
    "each day to find the love hiding inside us all",
    "",
    "4",
    "00:00:22,000 --> 00:00:32,000",
    "our hearts open wide and let fear fade away riding forward with joy toward the truth",
    "",
    "5",
    "00:00:36,000 --> 00:00:38,280",
    "polish the armor of",
    "",
    "6",
    "00:00:41,920 --> 00:00:44,400",
    "we find the love hiding",
    "",
    "7",
    "00:00:44,401 --> 00:00:48,400",
    "inside us all",
    "",
    "8",
    "00:00:48,800 --> 00:00:54,400",
    "polish the armor of light"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath]);

  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.equal(rows.length, 8);

  const maxDuration = rows.reduce((max, row) => Math.max(max, row.until - row.since), 0);
  assert.ok(maxDuration <= 10, `dense chorus cue should stay bounded, got ${maxDuration.toFixed(3)}s`);

  const chorusRows = rows.filter((row) => /polish the armor of light/i.test(row.text));
  assert.ok(chorusRows.length >= 3);
  for (const row of chorusRows) {
    const duration = row.until - row.since;
    assert.ok(duration <= 8.5, `chorus line should not freeze, got ${duration.toFixed(3)}s`);
  }
});

test("lyrics_to_srt_from_timing sentence-cues stay aligned to source timeline", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-sentence-cues.txt");
  const timingPath = path.join(dir, "timing-sentence-cues.srt");
  const outputPath = path.join(dir, "lyrics-sentence-cues.out.srt");

  const lyrics = [
    "Thank you, Rob.",
    "Indeed, I'll call our committee to order.",
    "Is there any declaration of interest?",
    "Not seeing one.",
    "Of course, you can declare it at any time."
  ].join("\n");

  const timing = [
    "1",
    "00:00:00,000 --> 00:00:00,120",
    "Thank you Rob",
    "",
    "2",
    "00:00:00,121 --> 00:00:00,300",
    "Indeed I'll call our committee",
    "",
    "3",
    "00:00:00,301 --> 00:00:00,540",
    "to order Is there any",
    "",
    "4",
    "00:00:00,541 --> 00:00:00,760",
    "declaration of interest Not seeing one",
    "",
    "5",
    "00:00:00,761 --> 00:00:01,000",
    "Of course you can declare it at any time"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath, "--sentence-cues"]);

  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.ok(rows.length >= 4, "sentence cues should remain fine-grained");
  assert.ok(rows[0].since <= 0.01, "first row should stay near source start");

  const last = rows[rows.length - 1];
  assert.ok(last.until <= 1.02, `last row should stay on source timeline, got ${last.until.toFixed(3)}s`);
});

test("lyrics_to_srt_from_timing sentence-cues never overlap", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-sentence-no-overlap.txt");
  const timingPath = path.join(dir, "timing-sentence-no-overlap.srt");
  const outputPath = path.join(dir, "lyrics-sentence-no-overlap.out.srt");

  const lyrics = [
    "Many assume salvation demands a perfect self before opening the heart, yet the secret is entering exactly as you are.",
    "We mistakenly think we must save ourselves alone, ignoring that true service arises precisely because we recognize our inability to save in isolation.",
    "Judgment is inappropriate for an energy field with consciousness; only love honors the self.",
    "This awakening transforms cold discernment into brotherhood and shared understanding, dissolving separations that density creates.",
    "The tomb is empty when you forgive yourself daily and roll the stone away, finding the self you always were without needing proof or a savior."
  ].join("\n");

  const timing = [
    "1",
    "00:00:00,320 --> 00:00:06,640",
    "Many assume salvation demands a perfect self before opening the heart yet the secret is entering exactly as you are",
    "",
    "2",
    "00:00:06,960 --> 00:00:15,600",
    "We mistakenly think we must save ourselves alone ignoring that true service arises precisely because we recognize our inability to save in isolation",
    "",
    "3",
    "00:00:16,160 --> 00:00:35,300",
    "Judgment is inappropriate for an energy field with consciousness only love honors the self",
    "",
    "4",
    "00:00:35,300 --> 00:00:36,800",
    "This awakening transforms cold discernment into brotherhood and shared understanding dissolving separations that density creates",
    "",
    "5",
    "00:00:36,200 --> 00:00:38,020",
    "The tomb is empty when you forgive yourself daily and roll the stone away finding the self you always were without needing proof or a savior"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath, "--sentence-cues"]);

  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.equal(rows.length, 5);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      rows[i].since >= rows[i - 1].until,
      `sentence cues must not overlap: row ${i} starts ${rows[i].since.toFixed(3)} before prior ends ${rows[i - 1].until.toFixed(3)}`
    );
  }
});

test("lyrics_to_srt_from_timing sentence-cues tolerate late start from overlap clamp", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-sentence-late-start-ok.txt");
  const timingPath = path.join(dir, "timing-sentence-late-start-ok.srt");
  const outputPath = path.join(dir, "lyrics-sentence-late-start-ok.out.srt");

  const lyrics = [
    "Line one carries most of the duration.",
    "Line two is short.",
    "Be love now."
  ].join("\n");

  const timing = [
    "1",
    "00:00:00,000 --> 00:00:08,320",
    "Line one carries most of the duration",
    "",
    "2",
    "00:00:08,320 --> 00:00:12,240",
    "Line two is short Be love now"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath, "--sentence-cues"]);

  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.equal(rows.length, 3);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].since >= rows[i - 1].until, "rows should stay non-overlapping");
  }
});

test("lyrics_to_srt_from_timing trims chunk-boundary overlap between adjacent sentences", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-boundary-overlap.txt");
  const timingPath = path.join(dir, "timing-boundary-overlap.srt");
  const outputPath = path.join(dir, "lyrics-boundary-overlap.out.srt");

  const lyrics = [
    "that cater to junior users who range in age from 18 months to 5 years and senior users who range in age from 5 to 12 years old.",
    "In age from five to twelve years old, a hard edge around the perimeter of the protective surface area."
  ].join("\n");

  const timing = [
    "1",
    "00:47:23,000 --> 00:47:31,900",
    "that cater to junior users who range in age from 18 months to 5 years and senior users who range in age from 5 to 12 years old",
    "",
    "2",
    "00:47:32,000 --> 00:47:36,000",
    "a hard edge around the perimeter of the protective surface area"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath, "--sentence-cues"]);
  const outText = await fs.readFile(outputPath, "utf8");
  const rows = parseSrtRows(outText);
  assert.equal(rows.length, 2);
  assert.ok(/5 to 12 years old\.$/iu.test(rows[0].text), "first row should keep full first sentence");
  assert.ok(
    /^a hard edge around the perimeter/iu.test(rows[1].text),
    `second row should trim repeated overlap prefix, got: ${rows[1].text}`
  );
});

test("lyrics_to_srt_from_timing strips markdown markers from subtitle text", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-markdown-clean.txt");
  const timingPath = path.join(dir, "timing-markdown-clean.srt");
  const outputPath = path.join(dir, "lyrics-markdown-clean.out.srt");

  const lyrics = [
    "[verse]",
    "**Bold** _light_ and [link](https://example.com) `code`.",
    "- Keep ~~steady~~ focus."
  ].join("\n");

  const timing = [
    "1",
    "00:00:00,000 --> 00:00:02,000",
    "bold light and link code",
    "",
    "2",
    "00:00:02,000 --> 00:00:04,000",
    "keep steady focus"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath]);

  const outText = await fs.readFile(outputPath, "utf8");
  assert.doesNotMatch(outText, /\*\*|__|~~|`|\[[^\]]+\]\([^)]*\)/u);
  assert.doesNotMatch(outText, /^\s*-\s+/mu);
  assert.match(outText, /Bold light and link code\./u);
  assert.match(outText, /Keep steady focus\./u);
});

test("lyrics_to_srt_from_timing sentence-cues sanitize markdown emphasis", async () => {
  const dir = path.resolve("quiz/sandpit");
  await fs.mkdir(dir, { recursive: true });
  const lyricsPath = path.join(dir, "lyrics-markdown-sentence-cues.txt");
  const timingPath = path.join(dir, "timing-markdown-sentence-cues.srt");
  const outputPath = path.join(dir, "lyrics-markdown-sentence-cues.out.srt");

  const lyrics = "**We** enter with _open_ hearts. [Read more](https://example.com).";
  const timing = [
    "1",
    "00:00:00,000 --> 00:00:01,600",
    "we enter with open hearts read more"
  ].join("\n");

  await fs.writeFile(lyricsPath, `${lyrics}\n`, "utf8");
  await fs.writeFile(timingPath, `${timing}\n`, "utf8");

  await runLyricsToSrt([lyricsPath, timingPath, outputPath, "--sentence-cues"]);

  const outText = await fs.readFile(outputPath, "utf8");
  assert.doesNotMatch(outText, /\*\*|_|`|\[[^\]]+\]\([^)]*\)/u);
  assert.match(outText, /We enter with open hearts\./u);
  assert.match(outText, /Read more\./u);
});
