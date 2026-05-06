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


test("live backend mode fails when url not changed", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-live-unchanged-"));
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  process.env.MEETING_PUBLISH_AUTH_TOKEN = "token";
  let thrown = null;
  try {
    await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async () => ({ endpoint: "https://helpos.ca/api/helpos/v1/post-image-update", parsed: { status: "ok", image_url: "" }, raw: "{}", metadata: {} }),
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
  assert.match(txt, /image_url_not_changed/u);
});

test("reads token from secret.pya when env is missing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-secret-token-"));
  fs.mkdirSync(path.join(tmp, "configure"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "configure", "secret.pya"), 'su name meeting publish auth token ob text "secret-token-value" ya\n', 'utf8');
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  delete process.env.MEETING_PUBLISH_AUTH_TOKEN;

  try {
    const result = await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async () => ({ endpoint: "https://helpos.ca/api/helpos/v1/post-image-update", parsed: { status: "ok", image_url: "https://new" }, raw: "{}", metadata: {} }),
    });
    const pre = fs.readFileSync(result.preflightPath, "utf8");
    assert.match(pre, /tokenSource is "secret_pya"\./u);
    assert.match(pre, /tokenSourceKey is "meeting publish auth token"\./u);
    assert.doesNotMatch(pre, /secret-token-value/u);
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }
});

test("env token overrides secret.pya token", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-env-overrides-secret-"));
  fs.mkdirSync(path.join(tmp, "configure"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "configure", "secret.pya"), 'su name meeting publish auth token ob text "secret-token-value" ya\n', 'utf8');
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  process.env.MEETING_PUBLISH_AUTH_TOKEN = "env-token-value";

  try {
    const result = await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async () => ({ endpoint: "https://helpos.ca/api/helpos/v1/post-image-update", parsed: { status: "ok", image_url: "https://new" }, raw: "{}", metadata: {} }),
    });
    const pre = fs.readFileSync(result.preflightPath, "utf8");
    assert.match(pre, /tokenSource is "env"\./u);
    assert.match(pre, /tokenSourceKey is "MEETING_PUBLISH_AUTH_TOKEN"\./u);
    assert.doesNotMatch(pre, /env-token-value/u);
    assert.doesNotMatch(pre, /secret-token-value/u);
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }
});

test("missing token writes auth diagnostics without leaking token values", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-image-missing-token-diag-"));
  fs.mkdirSync(path.join(tmp, "configure"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "configure", "secret.pya"), 'su name unrelated secret ob text "do-not-leak" ya\n', 'utf8');
  const prev = process.cwd();
  process.chdir(tmp);
  const oldEnv = { ...process.env };
  delete process.env.MEETING_PUBLISH_AUTH_TOKEN;

  let thrown = null;
  try {
    await runUpdate(["node", "cmd", "--post-ref", "7468", "--image", "x.png", "--dry-run"], {
      probeImage: async () => ({ exists: true, width: 512, height: 512, bytes: 111, mime: "image/png" }),
      fetchLivePost: async () => ({ endpoint: "https://example/api/v3/post?id=7468", post: { name: "n", body: "b", url: "https://old", thumbnail_url: "", community_id: 1, language_id: 37 } }),
      backendUpdate: async () => ({ endpoint: "https://helpos.ca/api/helpos/v1/post-image-update", parsed: { status: "ok", image_url: "https://new" }, raw: "{}", metadata: {} }),
    });
  } catch (err) {
    thrown = err;
  } finally {
    process.env = oldEnv;
    process.chdir(prev);
  }

  assert.ok(thrown);
  assert.match(String(thrown.message || ""), /Checked env keys/u);
  const runs = fs.readdirSync(path.join(tmp, "artifacts")).sort();
  const latest = path.join(tmp, "artifacts", runs[runs.length - 1]);
  const resultPath = path.join(latest, "post-image-update.result.pya");
  const txt = fs.readFileSync(resultPath, "utf8");
  assert.match(txt, /failedStage is "auth"\./u);
  assert.match(txt, /authPathsChecked count is /u);
  assert.match(txt, /authKeysChecked count is /u);
  assert.doesNotMatch(txt, /do-not-leak/u);
});
