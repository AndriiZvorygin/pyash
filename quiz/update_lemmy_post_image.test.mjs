import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, runUpdate, sha256Text, verifyExpectedHashes } from "../command/update_lemmy_post_image.mjs";

test("parseArgs parses required flags", () => {
  const out = parseArgs(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"]);
  assert.equal(out.postRef, "7468");
  assert.equal(out.imagePath, "x.png");
  assert.equal(out.dryRun, true);
});

test("parseArgs rejects non numeric post ref", () => {
  assert.throws(() => parseArgs(["node", "cmd", "--post-ref", "abc", "--image", "x.png"]), /numeric post id/u);
});

test("parseArgs rejects missing image", () => {
  assert.throws(() => parseArgs(["node", "cmd", "--post-ref", "7468"]), /--image is required/u);
});

test("sha256Text deterministic", () => {
  assert.equal(sha256Text("hello"), sha256Text("hello"));
  assert.notEqual(sha256Text("hello"), sha256Text("world"));
});

test("verifyExpectedHashes accepts matching hashes", () => {
  const title = "Title";
  const body = "Body";
  const titleHash = sha256Text(title);
  const bodyHash = sha256Text(body);
  const out = verifyExpectedHashes({ title, body, expectedTitleHash: titleHash, expectedBodyHash: bodyHash });
  assert.deepEqual(out.errors, []);
});

test("verifyExpectedHashes reports mismatches", () => {
  const out = verifyExpectedHashes({ title: "Title", body: "Body", expectedTitleHash: "deadbeef", expectedBodyHash: "beadfeed" });
  assert.ok(out.errors.includes("expected_title_hash_mismatch"));
  assert.ok(out.errors.includes("expected_body_hash_mismatch"));
});

test("dry-run performs no upload/edit and writes pya reports", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-dryrun-"));
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  try {
    let uploadCalled = 0;
    let editCalled = 0;
    const result = await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      uploadImage: async () => { uploadCalled += 1; return { endpoint: "u", imageUrl: "x" }; },
      editPostImage: async () => { editCalled += 1; return { endpoint: "e", method: "POST" }; },
    });
    assert.equal(result.dryRun, true);
    assert.equal(uploadCalled, 0);
    assert.equal(editCalled, 0);
    assert.ok(fs.existsSync(result.preflightPath));
    assert.ok(fs.existsSync(result.resultPath));
    assert.match(result.preflightPath, /\.pya$/u);
    assert.match(result.resultPath, /\.pya$/u);
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }
});

test("upload failure writes result report and does not call edit", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-uploadfail-"));
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  process.env.MEETING_PUBLISH_AUTH_TOKEN = "token";
  process.env.MEETING_PUBLISH_USERNAME = "user";
  process.env.MEETING_PUBLISH_PASSWORD = "pass";

  let editCalled = 0;
  let thrown = null;
  try {
    await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      lemmyLogin: async () => ({ endpoint: "https://example/api/v3/user/login", jwt: "jwt" }),
      uploadImage: async () => { throw new Error("upload boom"); },
      editPostImage: async () => { editCalled += 1; return { endpoint: "e", method: "POST" }; },
    });
  } catch (err) {
    thrown = err;
  } finally {
    process.chdir(prev);
    process.env = oldEnv;
  }

  assert.ok(thrown);
  assert.equal(editCalled, 0);
  const artifactsDir = path.join(tmp, "artifacts");
  const runs = fs.readdirSync(artifactsDir).sort();
  assert.ok(runs.length >= 1);
  const latest = path.join(artifactsDir, runs[runs.length - 1]);
  const resultPath = path.join(latest, "post-image-update.result.pya");
  assert.ok(fs.existsSync(resultPath));
  const txt = fs.readFileSync(resultPath, "utf8");
  assert.match(txt, /pass is no\./u);
  assert.match(txt, /failedStage is "upload"\./u);
});
