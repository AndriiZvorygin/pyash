import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("list from wo say returns configured backend", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "say backend default" }, ob: { text: "comfyui" }, be: "default" });
  const out = await interpret(parse("be list from wo say do"));
  const values = out?.value?.ve?.values ?? [];
  assert.deepEqual(values, ["comfyui"]);
});

