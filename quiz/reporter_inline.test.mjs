import assert from "node:assert/strict";
import test from "node:test";

import reporter from "../program/verbs/reporter.mjs";
import { remember, forget } from "../program/remember/index.mjs";
import { setRunNewspaperLines, clearRunNewspaperLines } from "../program/bridge/newspaper.mjs";

function withLines(lines) {
  setRunNewspaperLines(lines);
}

test("reporter extracts report from in-memory newspaper", async () => {
  forget();
  withLines([
    "exists su name sample-run from time 2026-01-30T00:00:00.000Z be run ya",
    "ob filename /workplace be run root ya",
    "su name demo be refinery def",
    "exists su name step ob la exists su name marker ob text \"ok\" be text ya ko be platform ya",
    "prah",
    "su name step ob text \"deadbeef\" from name demo to la exists su name marker ob text \"ok\" be text ya ko be checkpoint ya"
  ]);

  await reporter({ mood: "do", be: "reporter", to: { name: "report out", nameTypeWords: ["text"] } });

  const fact = remember("report out");
  assert.ok(fact?.ob?.text.includes("su name platform outcome 1 be json map def"));
  assert.ok(fact?.ob?.text.includes("su name platform name ob name step ya"));

  clearRunNewspaperLines();
});
