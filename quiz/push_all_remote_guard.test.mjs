import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GITHUB_REPO_PATH,
  parseSshRemote,
  resolveSshHost,
  validateGithubRemote,
} from "../command/push_all_check.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A runner that pretends `alias` is a ~/.ssh/config alias for github.com.
const aliasRunner = (host) => (host === "github-andriizvorygin" ? "github.com" : "");

test("push_all accepts the canonical github remote", () => {
  const outcome = validateGithubRemote(`git@github.com:${GITHUB_REPO_PATH}`, aliasRunner);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.resolved, "github.com");
});

test("push_all accepts an ssh config alias that resolves to github", () => {
  const outcome = validateGithubRemote(
    `git@github-andriizvorygin:${GITHUB_REPO_PATH}`,
    aliasRunner,
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.host, "github-andriizvorygin");
});

test("push_all rejects a remote that points at another repository", () => {
  const outcome = validateGithubRemote("git@github.com:someone/else.git", aliasRunner);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /expected/);
});

test("push_all rejects a host that does not resolve to github", () => {
  const outcome = validateGithubRemote(`git@evil.example.com:${GITHUB_REPO_PATH}`, aliasRunner);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /not github\.com/);
});

test("push_all rejects a non ssh remote", () => {
  const outcome = validateGithubRemote("https://github.com/AndriiZvorygin/pyash.git", aliasRunner);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /not an SSH URL/);
});

test("push_all parses ssh remote hosts and paths", () => {
  assert.deepEqual(parseSshRemote("git@github.com:AndriiZvorygin/pyash.git"), {
    host: "github.com",
    path: "AndriiZvorygin/pyash.git",
  });
  assert.equal(parseSshRemote("https://github.com/x/y.git"), null);
});

test("push_all falls back to the literal host when ssh cannot resolve it", () => {
  assert.equal(resolveSshHost("github.com", () => ""), "github.com");
});

test("the configured github remote in this repository passes its own guard", () => {
  const remote = path.join(repoRoot, ".git", "config");
  const config = fs.readFileSync(remote, "utf8");
  assert.match(config, /github-andriizvorygin|github\.com/);
});
