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

test("srt to itinerary writes series with since until and ob text", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-srt-itinerary-"));
  const srt = path.join(tmp, "in.srt");
  const out = path.join(tmp, "out.pya");
  await fs.writeFile(
    srt,
    [
      "1",
      "00:00:00,100 --> 00:00:02,900",
      "First visual thought.",
      "",
      "2",
      "00:00:03,000 --> 00:00:05,200",
      "Second visual thought."
    ].join("\n"),
    "utf8"
  );

  await execFileAsync(process.execPath, [
    "command/srt_to_itinerary_pya.mjs",
    srt,
    out,
    "--name",
    "teaching cuts"
  ], { cwd: "/workplace" });

  const text = await fs.readFile(out, "utf8");
  assert.match(text, /^su name teaching cuts be series def/m);
  assert.match(text, /su name cut 001 since num 0\.100 until num 2\.900 ob text "First visual thought\." ya/);
  assert.match(text, /su name cut 002 since num 3\.000 until num 5\.200 ob text "Second visual thought\." ya/);
});
