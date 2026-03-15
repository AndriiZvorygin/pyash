import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/parse_tokens.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("plain draw accepts to filename before with name map for named text prompts", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });

  doRemember({
    mood: "ya",
    su: { name: "thumbnail prompt" },
    ob: { text: "A bright educational thumbnail prompt." },
    be: "text"
  });
  doRemember({
    mood: "ya",
    su: { name: "draw size shorts" },
    be: "map",
    ob: {
      map: {
        width: { ob: { num: 1080 } },
        height: { ob: { num: 1920 } }
      }
    }
  });
  doRemember({ mood: "ya", su: { name: "draw workflow default" }, ob: { text: "Z-Image-TSV" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://localhost:8188" }, be: "default" });

  const prev = process.env.PYA_DRAW_FIXTURE_FILE;
  process.env.PYA_DRAW_FIXTURE_FILE = path.resolve("quiz/fixtures/pyash_raven.png");
  try {
    await interpret(parse(
      'ob name text thumbnail prompt fromstate wo text become wo photograph to filename "quiz/sandpit/draw-order-test.png" with name draw size shorts be draw do'
    ));
  } finally {
    if (prev === undefined) delete process.env.PYA_DRAW_FIXTURE_FILE;
    else process.env.PYA_DRAW_FIXTURE_FILE = prev;
  }

  const stat = await fs.stat("quiz/sandpit/draw-order-test.png");
  assert.ok(stat.isFile());
});
