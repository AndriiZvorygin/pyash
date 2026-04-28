import test from "node:test";
import assert from "node:assert/strict";

import { buildSrtFromChunks } from "../command/srt_from_qwen_say_chunks.mjs";

test("srt_from_qwen_say_chunks builds continuous srt from chunk timestamps", () => {
  const metadata = {
    chunks: [
      {
        index: 0,
        verification: {
          asrTimestamps: `0.00-0.50: Hello\n0.50-1.00: world`
        }
      },
      {
        index: 1,
        verification: {
          asrTimestamps: `0.00-0.40: Again\n0.40-0.90: now`
        }
      }
    ]
  };
  const srt = buildSrtFromChunks(metadata);
  assert.match(srt, /1\n00:00:00,000 --> 00:00:00,500\nHello/u);
  assert.match(srt, /2\n00:00:00,500 --> 00:00:01,000\nworld/u);
  assert.match(srt, /3\n00:00:01,000 --> 00:00:01,400\nAgain/u);
  assert.match(srt, /4\n00:00:01,400 --> 00:00:01,900\nnow/u);
});

test("srt_from_qwen_say_chunks uses chunk duration fallback for short-final bypass chunks", () => {
  const metadata = {
    chunks: [
      {
        index: 0,
        text: "Solon canceled debt bondage and restored broad ownership in Athens...",
        verification: {
          asrTimestamps: [
            "0.32-0.88: Solon",
            "0.88-1.44: cancelled",
            "1.44-1.68: debt",
            "1.68-2.32: bondage",
            "2.32-2.40: and",
            "2.40-2.96: restored",
            "2.96-3.28: broad",
            "3.28-3.76: ownership",
            "3.76-3.84: in",
            "3.84-4.40: Athens"
          ].join("\n"),
          hotTail: { durationSeconds: 4.634708 }
        }
      },
      {
        index: 1,
        text: "solon's athens...",
        verification: {
          asrBypassed: "short-final-chunk",
          asrChecked: false,
          asrPass: true,
          hotTail: { durationSeconds: 1.757667 }
        }
      }
    ]
  };

  const srt = buildSrtFromChunks(metadata);
  assert.match(srt, /00:00:03,840 --> 00:00:04,400\nAthens/u);
  assert.match(srt, /00:00:04,400 --> 00:00:06,158\nsolon's athens\.\.\./u);
});

test("srt_from_qwen_say_chunks fails when timed cue data is missing", () => {
  const metadata = {
    chunks: [{ index: 0, verification: { asrTimestamps: "", hotTail: {} }, text: "" }]
  };
  assert.throws(() => buildSrtFromChunks(metadata), /missing timed cue data/u);
});
