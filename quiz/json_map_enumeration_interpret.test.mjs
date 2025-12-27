import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("interpret json map enumeration example prints keys and values", async () => {
  forget();

  const source = await fs.readFile("examples/pyash/json-map-enumeration.pya", "utf8");
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    for (const line of lines) {
      await interpret(parse(line));
    }
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, [
    "su name result ob ve text a aa b be vector ya",
    "su name result ob ve text ace double bee be vector ya"
  ]);
});
