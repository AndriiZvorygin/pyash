import assert from "node:assert/strict";
import test from "node:test";

import { displaySessionName, normalizeSessionName } from "../web/session_name.js";

test("session names become safe stable Pyash session identities", () => {
  assert.equal(normalizeSessionName("Council Research: October 21!"), "council_research_october_21");
  assert.equal(normalizeSessionName("_Annual_Plan_"), "annual_plan");
  assert.equal(normalizeSessionName("!!!"), "");
  assert.equal(normalizeSessionName("A".repeat(60)).length, 48);
});

test("session IDs display as readable names in the selector", () => {
  assert.equal(displaySessionName("council-research_october"), "council research october");
});
