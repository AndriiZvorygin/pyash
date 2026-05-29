import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs, promptFromCut, runItineraryToDrawImages } from "../command/itinerary_to_draw_images.mjs";
import { parseItineraryPya, renderItineraryPya } from "../command/itinerary_io.mjs";

test("itinerary to draw images dry-run writes deterministic output plan", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-itinerary-draw-"));
  const input = path.join(tmp, "cuts.pya");
  const outDir = path.join(tmp, "out");
  await fs.writeFile(
    input,
    [
      "su name teaching cuts be series def",
      "su name cut 001 since num 0.100 until num 2.900 ob text \"First visual thought.\" ya",
      "su name cut 002 since num 3.000 until num 5.200 ob text \"Second visual thought.\" ya"
    ].join("\n"),
    "utf8"
  );

  let stdout = "";
  await runItineraryToDrawImages(
    [
      "node",
      "command/itinerary_to_draw_images.mjs",
      input,
      outDir,
      "--prefix",
      "teaching",
      "--limit",
      "2",
      "--dry-run"
    ],
    {
      writeOut: (text) => { stdout += text; }
    }
  );

  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\t.*teaching-cut-001\.png$/);
  assert.match(lines[1], /\t.*teaching-cut-002\.png$/);
});

test("promptFromCut composes system + user + cut text in order", () => {
  const prompt = promptFromCut(
    { obText: "the cut content" },
    "user instruction",
    "system style instruction"
  );
  assert.equal(prompt, "system style instruction\n\nuser instruction\n\nthe cut content");
});

test("parseArgs accepts width and height options", () => {
  const opts = parseArgs([
    "node",
    "command/itinerary_to_draw_images.mjs",
    "in.pya",
    "out",
    "--width",
    "1080",
    "--height",
    "1920"
  ]);
  assert.equal(opts.width, 1080);
  assert.equal(opts.height, 1920);
});

test("parseArgs accepts negative prompt option", () => {
  const opts = parseArgs([
    "node",
    "command/itinerary_to_draw_images.mjs",
    "in.pya",
    "out",
    "--negative-prompt",
    "no text, no subtitles"
  ]);
  assert.equal(opts.negativePrompt, "no text, no subtitles");
});

test("itinerary pya preserves optional source cut text", () => {
  const source = renderItineraryPya({
    itineraryName: "draw prompts",
    cuts: [
      {
        index: 1,
        name: "cut 001",
        since: 0,
        until: 2,
        obText: "a quiet computer desk",
        sourceText: "Andrii Zvorygin thinks through a design problem.",
        workflowName: "andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled"
      }
    ]
  });
  assert.match(source, /fromtext text "Andrii Zvorygin thinks through a design problem\." as text "andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled" ya/u);
  const parsed = parseItineraryPya(source);
  assert.equal(parsed.cuts[0].obText, "a quiet computer desk");
  assert.equal(parsed.cuts[0].sourceText, "Andrii Zvorygin thinks through a design problem.");
  assert.equal(parsed.cuts[0].workflowName, "andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled");
});
