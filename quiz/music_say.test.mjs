import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { musicSay } from "../program/verbs/music_say.mjs";
import { forget } from "../program/remember/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("music say writes opus and metadata", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "music-say-"));
  const outputPath = path.join(dir, "song.opus");
  const remember = (name) => {
    if (name === "music host") return { ob: { text: "http://music.local:8188" }, be: "default" };
    if (name === "music workflow root") return { ob: { text: "./music/" }, be: "default" };
    if (name === "music workflow default") return { ob: { text: "audio_ace_step_1_5_checkpoint" }, be: "default" };
    return null;
  };

  const result = await musicSay({
    mood: "do",
    be: "music say",
    ob: { text: "hello lyric line" },
    fromtext: { text: "ambient chill style" },
    to: { filename: outputPath }
  }, {
    remember,
    runMusicFn: async ({ output }) => {
      await fs.writeFile(output, "OPUS", "utf8");
      return { stdout: output };
    }
  });

  assert.equal(result?.be, "say");
  const written = await fs.readFile(outputPath, "utf8");
  assert.equal(written, "OPUS");
  const metadataText = await fs.readFile(`${outputPath}.metadata.json`, "utf8");
  assert.match(metadataText, /"format":"opus"/u);
});

test("music say maps with name map options into runner payload", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "music-say-"));
  const outputPath = path.join(dir, "song.opus");
  let seenOptions = null;
  const remember = (name) => {
    if (name === "opts") {
      return {
        ob: {
          map: {
            bpm: { num: 90 },
            seed: { num: 123456 },
            seconds: { num: 10 },
            duration: { num: 10 },
            timesignature: { text: "4" },
            language: { text: "en" },
            keyscale: { text: "C major" }
          }
        }
      };
    }
    return null;
  };

  await musicSay({
    mood: "do",
    be: "music say",
    ob: { text: "lyric test" },
    fromtext: { text: "style test" },
    with: { name: "opts" },
    to: { filename: outputPath }
  }, {
    remember,
    runMusicFn: async ({ options, output }) => {
      seenOptions = options;
      await fs.writeFile(output, "OPUS", "utf8");
      return { stdout: output };
    }
  });

  assert.deepEqual(seenOptions, {
    bpm: 90,
    seed: 123456,
    seconds: 10,
    duration: 10,
    timesignature: "4",
    language: "en",
    keyscale: "C major"
  });
});

test("music say signature works through interpret", async () => {
  forget();
  process.env.PYA_MUSIC_COMFYUI_FIXTURE_FILE = path.join(process.cwd(), "caterer", "whisper.cpp", "samples", "jfk.wav");
  try {
    const outputPath = "artifacts/music/music-sig-test.opus";
    const sentence = parse('su name out fromtext text "ambient focus" ob text "hello world" to filename "artifacts/music/music-sig-test.opus" be music say do');
    const out = await interpret(sentence);
    assert.equal(out?.value?.text, outputPath);
    const stat = await fs.stat(path.join(process.cwd(), outputPath));
    assert.ok(stat.isFile());
  } finally {
    delete process.env.PYA_MUSIC_COMFYUI_FIXTURE_FILE;
  }
});
