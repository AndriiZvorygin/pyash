import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { footnoteVideo } from "../program/verbs/itinerary_media.mjs";

test("footnoteVideo forwards by num margin ratio to runner", async () => {
  const cwd = process.cwd();
  const tmpRoot = await fs.mkdtemp(path.join(cwd, "artifacts", "footnote-margin-pass-"));
  const inputVideo = path.join(tmpRoot, "input.mp4");
  const inputSrt = path.join(tmpRoot, "input.srt");
  const outputVideo = path.join(tmpRoot, "output.mp4");
  await fs.writeFile(inputVideo, "video", "utf8");
  await fs.writeFile(inputSrt, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");

  let captured = null;
  const sentence = {
    from: { filename: inputSrt },
    fromstate: { wo: "srt" },
    with: { filename: inputVideo },
    to: { filename: outputVideo },
    as: { wo: "wordflow" },
    by: { num: 0.4 }
  };

  try {
    const result = await footnoteVideo(sentence, {
      remember: () => ({}),
      runFootnoteVideoFn: async (opts) => {
        captured = { ...opts };
        await fs.writeFile(opts.outputVideo, "burned", "utf8");
        return { stdout: "", stderr: "" };
      }
    });
    assert.ok(captured, "runner should be called");
    assert.equal(captured.marginRatio, 0.4);
    assert.equal(captured.mode, "wordflow");
    assert.equal(captured.startDelaySeconds, 0.05);
    assert.equal(result?.ob?.filename, outputVideo);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

