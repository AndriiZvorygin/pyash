import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, sha256Text, verifyExpectedHashes } from "../command/update_lemmy_post_image.mjs";

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
