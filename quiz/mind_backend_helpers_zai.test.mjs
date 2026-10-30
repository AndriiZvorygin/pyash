import test from "node:test";
import assert from "node:assert/strict";

import {
  MIND_BACKEND_CHOICES,
  canonicalizeMindBackend,
  defaultMindHostForSource,
  defaultMindModelForSource,
  suggestMindRelayName
} from "../command/pyash/mind_backend_helpers.mjs";
import { normalizeMindBackendName } from "../program/verbs/mind/backend.mjs";
import { normalizeSaddleBackend } from "../program/agent/coding_saddle.mjs";

test("Z.AI has a selectable GLM Coding Plan mind profile", () => {
  assert.equal(canonicalizeMindBackend("zai"), "zai command mind");
  assert.equal(normalizeMindBackendName("zai"), "zai command mind");
  assert.equal(normalizeSaddleBackend("zai command mind"), "zai");
  assert.ok(MIND_BACKEND_CHOICES.some((choice) => choice.key === "zai"));
  assert.equal(defaultMindHostForSource("zai"), "https://api.z.ai/api/v1");
  assert.equal(defaultMindModelForSource("zai"), "glm-5.3");
  assert.equal(suggestMindRelayName({ source: "zai", model: "glm-5.3" }), "zai-coder");
});
