#!/usr/bin/env node
// The Yiniana catalogue transcripts.
//
// The house hears every song it makes: the hear lane says what it hears, and
// the words that came back are kept with the song, so a listener can read
// along with it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

import { parseSrt } from "../program/library/radio/ticker.mjs";
import { buildListenArgs, transcribeCatalogue, transcribeSong } from "../command/yiniana_transcribe_catalogue.mjs";

const FRAME_BYTES = Math.floor((144 * 128000) / 44100);

function syntheticMp3({ frames = 6 } = {}) {
  const frame = Buffer.alloc(FRAME_BYTES);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

const SRT = [
  "1",
  "00:00:04,000 --> 00:00:09,000",
  "The words of the sheet.",
  ""
].join("\n");

async function makeTempDir(prefix = "yiniana-transcribe-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function run(line) {
  return interpret(parse(line));
}

/**
 * A hear lane that is not there: the window is written and the subtitle comes
 * out of the air.
 */
function fakeHear({ srt = SRT } = {}) {
  return async (command, args, options = {}) => {
    const at = args.indexOf("--output");
    if (at >= 0) {
      const output = args[at + 1];
      await fs.writeFile(output.replace(/\.txt$/u, ".srt"), srt);
      await fs.writeFile(output, "The words the house heard.\n");
    }
    return { stderr: "" };
  };
}

test("a song is heard by the lane the house trusts", async () => {
  const root = await makeTempDir();
  const audio = path.join(root, "audio");
  const lyrics = path.join(root, "lyrics");
  await fs.mkdir(audio, { recursive: true });
  await fs.mkdir(lyrics, { recursive: true });
  await fs.writeFile(path.join(audio, "ace-step-dignity.mp3"), syntheticMp3());
  await fs.writeFile(path.join(lyrics, "song-dignity.txt"), "[Verse]\nThe words of the sheet\n");

  const result = await transcribeSong({
    track: {
      filename: "ace-step-dignity.mp3",
      path: path.join(audio, "ace-step-dignity.mp3"),
      topic: "dignity",
      engine: "ace-step",
      lyricSheet: path.join(lyrics, "song-dignity.txt")
    },
    lyricsDirectory: lyrics,
    workDirectory: path.join(root, "work"),
    repoRoot: root,
    runCommand: fakeHear()
  });

  assert.equal(result.status, "heard");
  const transcript = path.join(lyrics, "song-dignity.srt");
  assert.ok(await fs.readFile(transcript, "utf8"), "the transcript is kept beside the sheet");
  const aligned = path.join(lyrics, "song-dignity.aligned.srt");
  assert.match(await fs.readFile(aligned, "utf8"), /The words of the sheet/u, "the words of the song are placed at the times");
  assert.equal(parseSrt(await fs.readFile(aligned, "utf8"))[0].start, 4, "the words are placed at the time they were heard");
  const leftovers = (await fs.readdir(path.join(root, "work"))).filter((name) => name.endsWith(".part"));
  assert.deepEqual(leftovers, [], "no part file was left behind");
  await fs.rm(root, { recursive: true, force: true });
});

test("a song that was already heard is not heard again", async () => {
  const root = await makeTempDir();
  const lyrics = path.join(root, "lyrics");
  await fs.mkdir(lyrics, { recursive: true });
  await fs.writeFile(path.join(lyrics, "song-dignity.txt"), "[Verse]\nThe words of the sheet\n");
  await fs.writeFile(path.join(lyrics, "song-dignity.srt"), SRT);

  const result = await transcribeSong({
    track: {
      filename: "ace-step-dignity.mp3",
      path: path.join(root, "ace-step-dignity.mp3"),
      topic: "dignity",
      engine: "ace-step",
      lyricSheet: path.join(lyrics, "song-dignity.txt")
    },
    lyricsDirectory: lyrics,
    workDirectory: path.join(root, "work"),
    repoRoot: root,
    runCommand: async () => {
      throw new Error("the song was heard again");
    }
  });

  assert.equal(result.status, "heard", "the words were placed against what was heard before");
  assert.ok(await fs.readFile(path.join(lyrics, "song-dignity.aligned.srt"), "utf8"), "the words are placed");
  await fs.rm(root, { recursive: true, force: true });
});

test("the catalogue is heard song by song, and a song that cannot be heard does not stop the rest", async () => {
  const root = await makeTempDir();
  const audio = path.join(root, "audio");
  const lyrics = path.join(root, "lyrics");
  await fs.mkdir(audio, { recursive: true });
  await fs.mkdir(lyrics, { recursive: true });
  await fs.writeFile(path.join(audio, "ace-step-dignity.mp3"), syntheticMp3());
  await fs.writeFile(path.join(audio, "ace-step-grace.mp3"), syntheticMp3());
  await fs.writeFile(path.join(lyrics, "song-dignity.txt"), "[Verse]\nThe words of the sheet\n");
  await fs.writeFile(path.join(lyrics, "song-grace.txt"), "[Verse]\nThe words of the sheet\n");

  let calls = 0;
  const summary = await transcribeCatalogue({
    catalogueDirectory: audio,
    lyricsDirectory: lyrics,
    workDirectory: path.join(root, "work"),
    repoRoot: root,
    runCommand: async (command, args) => {
      calls += 1;
      if (calls === 1) throw new Error("the lane was busy");
      const at = args.indexOf("--output");
      if (at >= 0) {
        const output = args[at + 1];
        await fs.writeFile(output.replace(/\.txt$/u, ".srt"), SRT);
        await fs.writeFile(output, "The words the house heard.\n");
      }
      return { stderr: "" };
    }
  });

  assert.equal(summary.songs, 2);
  assert.equal(summary.heard, 1, "the song that could be heard was heard");
  assert.equal(summary.failed, 1, "the song that could not be heard is counted, not hidden");
  await fs.rm(root, { recursive: true, force: true });
});

test("the song is heard the way the hear lane takes it", () => {
  const args = buildListenArgs({ audioPath: "/song.mp3", windowPath: "/song.wav" });

  assert.ok(args.includes("16000"), "the lane hears one voice at sixteen kilohertz");
  assert.equal(args[args.length - 1], "/song.wav");
});

test("the pyash ceremony runs the transcribe command", async () => {
  forget();
  await run('from filename "./module/radio_transcribe.pya" to name radio transcribe be import do');
  await run('ob text "printf radio-transcribe-up" to name text radio transcribe command be text do');

  const result = await run("su name radio transcribe stage be radio transcribe run do");

  const output = String(result?.result?.text ?? result?.ob?.text ?? "");
  assert.match(output, /radio-transcribe-up/u);
  forget();
});
