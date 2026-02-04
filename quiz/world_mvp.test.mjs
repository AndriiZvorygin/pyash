import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("world mvp writes activity and files under world root", async () => {
  const worldRoot = path.resolve("quiz/sandpit/world-mvp");
  const placeDir = path.join(worldRoot, "commons");
  const activityPath = path.join(placeDir, ".activity.pya");
  const notePath = path.join(placeDir, "notes", "hello.txt");

  await fs.mkdir(placeDir, { recursive: true });

  const program = [
    `exists su name world tools ob bool truth ya`,
    `exists su name world root ob filename "${worldRoot}" be default ya`,
    `exists su name world agent ob text "demo" be text ya`,
    `exists su name world place ob text "commons" be text ya`,
    `to name text "commons" be go do`,
    `be list do`,
    `ob text "Hello from the commons." to filename "notes/hello.txt" be write do`,
    `be read ob wo tail atmost num 10 from filename ".activity.pya" do`,
    `be sleep do`
  ].join("\n");

  try {
    forget();
    const lines = splitSentences(program);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      await interpret(parse(trimmed));
    }

    const activityText = await fs.readFile(activityPath, "utf8");
    assert.match(activityText, /be go ya/);
    assert.match(activityText, /be list ya/);
    assert.match(activityText, /be write ya/);
    assert.match(activityText, /be sleep ya/);

    const note = await fs.readFile(notePath, "utf8");
    assert.equal(note.trim(), "Hello from the commons.");

    const listFact = remember("world list");
    assert.ok(listFact?.ob?.map?.entries);
    assert.ok(listFact?.ob?.map?.presence);
  } finally {
    await fs.rm(worldRoot, { recursive: true, force: true });
  }
});
