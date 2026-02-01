import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";

const ARTIFACT_PROMPT = "artifacts/see/prompt.txt";
const ARTIFACT_IMAGE = "artifacts/see/sample.png";

async function ensureArtifacts() {
  await fs.mkdir("artifacts/see", { recursive: true });
  await fs.writeFile(ARTIFACT_IMAGE, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(ARTIFACT_PROMPT, "Describe this image.", "utf8");
}

function runWithOverrides({ fixtureText, fixtureFile } = {}) {
  const env = { ...process.env };
  const args = ["command/see_vl_runner.mjs", "--prompt-file", ARTIFACT_PROMPT, "--image", ARTIFACT_IMAGE];
  if (fixtureText) {
    args.push("--fixture-text", fixtureText);
  }
  if (fixtureFile) {
    args.push("--fixture-file", fixtureFile);
  }
  const res = spawnSync("node", args, { env, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(res.status, 0, `runner exited ${res.status}: ${res.stderr}`);
  return String(res.stdout ?? "").trim();
}

test("see_vl_runner respects text fixture override", async () => {
  await ensureArtifacts();
  const text = runWithOverrides({ fixtureText: "vision description" });
  assert.equal(text, "vision description");
});

test("see_vl_runner respects fixture file override", async () => {
  await ensureArtifacts();
  await fs.writeFile("artifacts/see/fixture.txt", "file description", "utf8");
  const text = runWithOverrides({ fixtureFile: "artifacts/see/fixture.txt" });
  assert.equal(text, "file description");
});
