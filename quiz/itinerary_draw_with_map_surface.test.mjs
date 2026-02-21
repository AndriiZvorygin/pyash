import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/parse_tokens.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("draw itinerary accepts with name map for width and height", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });

  doRemember({
    mood: "ya",
    su: { name: "teaching cuts" },
    be: "itinerary",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "cut 001" },
          since: { num: 0 },
          until: { num: 2 },
          ob: { text: "A short teaching image concept." },
          be: "cut"
        }
      ]
    }
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
      "from name itinerary teaching cuts ob text \"Generate one vertical teaching image.\" fromstate wo text become wo photograph with name draw size shorts to filename \"quiz/sandpit/with-map-draw\" as text \"shorts\" be draw do"
    ));
  } finally {
    if (prev === undefined) delete process.env.PYA_DRAW_FIXTURE_FILE;
    else process.env.PYA_DRAW_FIXTURE_FILE = prev;
  }

  const files = await fs.readdir("quiz/sandpit/with-map-draw");
  assert.ok(files.some((name) => name.endsWith(".png")));
});
