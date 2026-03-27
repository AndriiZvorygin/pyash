import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("speaker identity module exposes begin discharge stop lifecycle signatures", async (t) => {
  t.after(async () => {
    try {
      await run("be stop as wo speaker identity do");
    } catch {}
  });

  forget();
  await run("from name ./module/speaker_identity.pya ob name identify to name identify be import do");
  await run("from name ./module/speaker_identity.pya ob name rename speaker to name rename speaker be import do");

  const beginRes = await run("be begin as wo speaker identity do");
  assert.equal(beginRes?.invoked, "begin");
  assert.equal(beginRes?.result?.boolean, true);

  const dischargeRes = await run("be discharge as wo speaker identity do");
  assert.equal(dischargeRes?.invoked, "discharge");
  assert.equal(typeof dischargeRes?.result?.boolean, "boolean");

  const renameRes = await run('from text "speaker_001" to text "speaker_001" be rename speaker do');
  assert.equal(renameRes?.invoked, "rename speaker");
  assert.equal(typeof renameRes?.result?.text, "string");

  const stopRes = await run("be stop as wo speaker identity do");
  assert.equal(stopRes?.invoked, "stop");
  assert.equal(stopRes?.result?.boolean, true);
});

test("speaker identify signature is module-owned and surfaces worker error context", async (t) => {
  t.after(async () => {
    try {
      await run("be stop as wo speaker identity do");
    } catch {}
  });

  forget();
  await run("from name ./module/speaker_identity.pya ob name identify to name identify be import do");
  await run("from name ./module/speaker_identity.pya ob name rename speaker to name rename speaker be import do");

  await assert.rejects(
    () => run('fromstate wo audio from filename "/tmp/pyash-speaker-missing.wav" to name text who be identify do'),
    (err) => err?.sentence?.su?.name === "file or directory unavailable error"
  );

  await run("su name speaker identify options be map def");
  await run("su name same_speaker_threshold ob num 0.72 ya");
  await run("su name known_speaker_threshold ob num 0.68 ya");
  await run("prah");
  await assert.rejects(
    () => run('fromstate wo audio from filename "/tmp/pyash-speaker-missing.wav" with name speaker identify options to name text who be identify do'),
    (err) => err?.sentence?.su?.name === "file or directory unavailable error"
  );

  await run("su name speaker identify options spaced be map def");
  await run("su name same speaker threshold ob num 0.72 ya");
  await run("su name known speaker threshold ob num 0.68 ya");
  await run("su name clip seconds ob num 8 ya");
  await run("prah");
  await assert.rejects(
    () => run('fromstate wo audio from filename "/tmp/pyash-speaker-missing.wav" with name speaker identify options spaced to name text who be identify do'),
    (err) => err?.sentence?.su?.name === "file or directory unavailable error"
  );
});
