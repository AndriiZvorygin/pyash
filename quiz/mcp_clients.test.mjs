import test from "node:test";
import assert from "node:assert/strict";

import { resolveMcpProgram } from "../program/motor/mcp/clients.mjs";

test("mcp stdio node program resolves to process exec path", () => {
  assert.equal(resolveMcpProgram("node"), process.execPath);
  assert.equal(resolveMcpProgram(" node "), process.execPath);
});

test("mcp stdio non-node program remains unchanged", () => {
  assert.equal(resolveMcpProgram("python3"), "python3");
});
