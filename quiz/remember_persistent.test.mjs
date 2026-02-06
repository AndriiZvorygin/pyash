import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowDate() {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("remember writes daily and long memory files", async () => {
  forget();
  const tmpRoot = path.resolve("/tmp/pyash-remember-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  doRemember({
    mood: "ya",
    be: "root",
    su: { name: "world root" },
    ob: { filename: tmpRoot }
  });
  doRemember({
    mood: "ya",
    be: "text",
    su: { name: "agent name" },
    ob: { text: "tester" }
  });

  await interpret(parse('be remember ob text "daily note" during date "' + todayDate() + '" do'));
  await interpret(parse('be remember ob text "long note" during wo always do'));
  await interpret(parse('be remember ob text "today note" during date today do'));
  await interpret(parse('be remember ob text "tomorrow note" during date tomorrow do'));

  const dailyFile = path.join(tmpRoot, "house", "tester", "memory", `${todayDate()}.md`);
  const longFile = path.join(tmpRoot, "house", "tester", "memory", "MEMORY.md");
  const tomorrowFile = path.join(tmpRoot, "house", "tester", "memory", `${tomorrowDate()}.md`);

  assert.ok(await exists(dailyFile));
  assert.ok(await exists(longFile));
  assert.ok(await exists(tomorrowFile));
  const daily = await fs.readFile(dailyFile, "utf8");
  const long = await fs.readFile(longFile, "utf8");
  const tomorrow = await fs.readFile(tomorrowFile, "utf8");
  assert.match(daily, /daily note/);
  assert.match(daily, /today note/);
  assert.match(long, /long note/);
  assert.match(tomorrow, /tomorrow note/);
});
