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
  assert.equal(out.directPictrs, false);
});

test("parseArgs supports direct pictrs explicit flag", () => {
  const out = parseArgs(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--direct-pictrs"]);
  assert.equal(out.directPictrs, true);
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

test("default mode uses backend endpoint and sends dry_run=true", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-backend-dryrun-"));
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  process.env.MEETING_PUBLISH_AUTH_TOKEN = "token";

  let backendCalled = 0;
  let backendDryRun = null;
  try {
    const result = await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async (opts) => {
        backendCalled += 1;
        backendDryRun = opts.dryRun;
        return { endpoint: "https://helpos.ca/api/helpos/v1/post-image-update", parsed: { status: "ok", image_url: "https://new" }, raw: "{}", metadata: {} };
      },
    });
    assert.equal(result.dryRun, true);
    assert.equal(backendCalled, 1);
    assert.equal(backendDryRun, true);
    assert.ok(fs.existsSync(result.preflightPath));
    assert.ok(fs.existsSync(result.resultPath));
    assert.match(result.preflightPath, /\.pya$/u);
    assert.match(result.resultPath, /\.pya$/u);
    const txt = fs.readFileSync(result.resultPath, "utf8");
    assert.match(txt, /updateMode is "backend_endpoint"\./u);
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }
});

test("missing auth token fails before backend request", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-noauth-"));
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  delete process.env.MEETING_PUBLISH_AUTH_TOKEN;

  let backendCalled = 0;
  let thrown = null;
  try {
    await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async () => { backendCalled += 1; throw new Error("should not call"); },
    });
  } catch (err) {
    thrown = err;
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }

  assert.ok(thrown);
  assert.equal(backendCalled, 0);
  const runs = fs.readdirSync(path.join(tmp, "artifacts")).sort();
  const latest = path.join(tmp, "artifacts", runs[runs.length - 1]);
  const resultPath = path.join(latest, "post-image-update.result.pya");
  const txt = fs.readFileSync(resultPath, "utf8");
  assert.match(txt, /failedStage is "auth"\./u);
});

test("backend failure writes result pya", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-backend-fail-"));
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  process.env.MEETING_PUBLISH_AUTH_TOKEN = "token";

  let thrown = null;
  try {
    await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async () => { throw new Error("backend boom"); },
    });
  } catch (err) {
    thrown = err;
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }

  assert.ok(thrown);
  const runs = fs.readdirSync(path.join(tmp, "artifacts")).sort();
  const latest = path.join(tmp, "artifacts", runs[runs.length - 1]);
  const resultPath = path.join(latest, "post-image-update.result.pya");
  const txt = fs.readFileSync(resultPath, "utf8");
  assert.match(txt, /pass is no\./u);
  assert.match(txt, /failedStage is "backend_update"\./u);
});
