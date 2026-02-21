import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

test("itinerary to video dry-run resolves durations and images", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-itinerary-video-"));
  const cuts = path.join(tmp, "cuts.pya");
  const images = path.join(tmp, "images");
  const audio = path.join(tmp, "audio.wav");
  const out = path.join(tmp, "out.mp4");
  await fs.mkdir(images, { recursive: true });
  await fs.writeFile(
    cuts,
    [
      "su name teaching cuts be series def",
      "su name cut 001 since num 0.000 until num 2.500 ob text \"First\" ya",
      "su name cut 002 since num 2.500 until num 5.000 ob text \"Second\" ya"
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(path.join(images, "teaching-cut-001-000000000-000002500.png"), "png", "utf8");
  await fs.writeFile(path.join(images, "teaching-cut-002-000002500-000005000.png"), "png", "utf8");
  await fs.writeFile(audio, "wav", "utf8");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "command/itinerary_to_video.mjs",
      cuts,
      images,
      audio,
      out,
      "--prefix",
      "teaching",
      "--dry-run"
    ],
    { cwd: "/workplace" }
  );

  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^1\t2\.500\t.*teaching-cut-001-000000000-000002500\.png$/);
  assert.match(lines[1], /^2\t2\.500\t.*teaching-cut-002-000002500-000005000\.png$/);
});

test("itinerary to video dry-run bridges timeline gaps using next since", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-itinerary-video-gap-"));
  const cuts = path.join(tmp, "cuts.pya");
  const images = path.join(tmp, "images");
  const audio = path.join(tmp, "audio.wav");
  const out = path.join(tmp, "out.mp4");
  await fs.mkdir(images, { recursive: true });
  await fs.writeFile(
    cuts,
    [
      "su name teaching cuts be series def",
      "su name cut 001 since num 0.000 until num 2.000 ob text \"First\" ya",
      "su name cut 002 since num 5.000 until num 6.000 ob text \"Second\" ya"
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(path.join(images, "teaching-cut-001-000000000-000002000.png"), "png", "utf8");
  await fs.writeFile(path.join(images, "teaching-cut-002-000005000-000006000.png"), "png", "utf8");
  await fs.writeFile(audio, "wav", "utf8");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "command/itinerary_to_video.mjs",
      cuts,
      images,
      audio,
      out,
      "--prefix",
      "teaching",
      "--dry-run"
    ],
    { cwd: "/workplace" }
  );

  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^1\t5\.000\t.*teaching-cut-001-000000000-000002000\.png$/);
  assert.match(lines[1], /^2\t1\.000\t.*teaching-cut-002-000005000-000006000\.png$/);
});

test("itinerary to video dry-run can auto-match cut images without explicit prefix", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-itinerary-video-noprefix-"));
  const cuts = path.join(tmp, "cuts.pya");
  const images = path.join(tmp, "images");
  const audio = path.join(tmp, "audio.wav");
  const out = path.join(tmp, "out.mp4");
  await fs.mkdir(images, { recursive: true });
  await fs.writeFile(
    cuts,
    [
      "su name teaching cuts be series def",
      "su name cut 001 since num 0.000 until num 2.000 ob text \"First\" ya"
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(path.join(images, "photos-cut-001.png"), "png", "utf8");
  await fs.writeFile(audio, "wav", "utf8");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "command/itinerary_to_video.mjs",
      cuts,
      images,
      audio,
      out,
      "--dry-run"
    ],
    { cwd: "/workplace" }
  );

  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^1\t2\.000\t.*photos-cut-001\.png$/);
});
