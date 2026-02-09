import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { forget } from "../program/remember/index.mjs";
import hear from "../program/verbs/hear.mjs";
import glance from "../program/verbs/glance.mjs";

test("hear emits audio/direct evidential tags by default", async () => {
  forget();
  const result = await hear(
    { mood: "do", be: "hear", ob: { text: "Prompt" } },
    {
      remember: (name) => {
        if (name === "hear fixture") return { ob: { text: "fixture" } };
        return null;
      }
    }
  );
  assert.equal(result?.fromstate?.wo, "audio");
  assert.equal(result?.accordingto?.wo, "direct");
});

test("glance emits optical/direct evidential tags by default", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "glance-evidential-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");
  const result = await glance({ mood: "do", be: "glance", ob: { filename: file } });
  assert.equal(result?.fromstate?.wo, "optical");
  assert.equal(result?.accordingto?.wo, "direct");
});
