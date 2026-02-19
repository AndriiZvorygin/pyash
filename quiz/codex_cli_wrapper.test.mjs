import test from "node:test";
import assert from "node:assert/strict";

import { parseCodexWrapperArgs } from "../command/pyash/codex_cli.mjs";

test("parse codex wrapper args keeps passthrough after --", () => {
  const parsed = parseCodexWrapperArgs([
    "--root", "/tmp/world",
    "--tools-map", "agent tools",
    "--",
    "resume",
    "--last"
  ]);
  assert.equal(parsed.root, "/tmp/world");
  assert.equal(parsed.toolsMap, "agent tools");
  assert.equal(parsed.noMcp, false);
  assert.deepEqual(parsed.passthrough, ["resume", "--last"]);
});

test("parse codex wrapper args supports equals form and no-mcp", () => {
  const parsed = parseCodexWrapperArgs([
    "--root=/tmp/world",
    "--tools-map=ops",
    "--no-mcp",
    "exec",
    "hi"
  ]);
  assert.equal(parsed.root, "/tmp/world");
  assert.equal(parsed.toolsMap, "ops");
  assert.equal(parsed.noMcp, true);
  assert.deepEqual(parsed.passthrough, ["exec", "hi"]);
});

test("parse codex wrapper args defaults tools map", () => {
  const parsed = parseCodexWrapperArgs(["resume", "--last"]);
  assert.equal(parsed.root, "");
  assert.equal(parsed.toolsMap, "agent tools");
  assert.equal(parsed.noMcp, false);
  assert.deepEqual(parsed.passthrough, ["resume", "--last"]);
});
