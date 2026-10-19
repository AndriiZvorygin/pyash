import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { command } from "../program/verbs/command.mjs";
import { withCommandResumeIdentity } from "../program/bridge/command_identity.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";

test.afterEach(() => {
  clearExchangeRecorder();
  forget();
});

test("repeated commands have durable request result identities and compatibility aliases", async () => {
  forget();
  const records = [];
  setExchangeRecorder({
    runRoot: process.cwd(),
    record: sentence => records.push(sentence)
  });

  const first = await interpret(parse('su name first output ob text "printf first" to name text first output be command do'));
  const second = await interpret(parse('su name second output ob text "printf second" to name text second output be command do'));

  assert.equal(first?.be, "command");
  assert.equal(second?.be, "command");
  assert.match(first?.su?.name ?? "", /^command request \d{6}$/u);
  assert.match(second?.su?.name ?? "", /^command request \d{6}$/u);
  assert.notEqual(first?.su?.name, second?.su?.name);
  assert.equal(first?.su?.name, "command request 000001");
  assert.equal(second?.su?.name, "command request 000002");

  assert.equal(remember(first.su.name)?.ob?.text, "first");
  assert.equal(remember(second.su.name)?.ob?.text, "second");
  assert.equal(remember("first output")?.ob?.text, "first");
  assert.equal(remember("second output")?.ob?.text, "second");
  assert.equal(remember("result")?.ob?.text, "second");

  const requestRecords = records.filter(record => record?.be === "evoke" && /^command request \d{6}$/u.test(record?.su?.name ?? ""));
  const auditRecords = records.filter(record => record?.be === "command audit");
  assert.deepEqual(requestRecords.map(record => record.su.name), [first.su.name, second.su.name]);
  assert.ok(auditRecords.length >= 2);
  for (const request of [first, second]) {
    assert.ok(auditRecords.some(record => record.to?.name === request.su.name));
  }
  assert.ok(records.findIndex(record => record?.be === "evoke" && record.su?.name === first.su.name)
    < records.findIndex(record => record?.be === "command audit" && record.to?.name === first.su.name));
});

test("declared command output records identity on artifacts and every exchange operation", async () => {
  forget();
  const records = [];
  setExchangeRecorder({ runRoot: process.cwd(), record: sentence => records.push(sentence) });
  const output = "artifacts/command-result-identity/output.txt";
  try {
    const result = await interpret(parse(`ob text "printf artifact" to filename "${output}" be command do`));
    await interpret(parse(`ob text "printf artifact" to filename "${output}" be command do`));

    assert.equal(result?.be, "command");
    const artifacts = records.filter(record => record?.be === "artifact");
    const exchanges = records.filter(record => record?.be === "exchange");
    const artifact = artifacts[0];
    assert.ok(artifact);
    assert.equal(artifacts.length, 1, "reusing a locator keeps one artifact declaration");
    assert.match(artifact.ob?.name ?? "", /^command request \d{6}$/u);
    assert.deepEqual(exchanges.map(exchange => exchange.ob?.name), [
      "command request 000001",
      "command request 000002"
    ]);
    assert.ok(exchanges.every(exchange => exchange.as?.name === "write"));
  } finally {
    await fs.rm(path.dirname(output), { recursive: true, force: true });
  }
});

test("forget resets the command identity allocator for a fresh run", async () => {
  forget();
  const first = await interpret(parse('ob text "printf one" be command do'));
  forget();
  const second = await interpret(parse('ob text "printf two" be command do'));
  assert.equal(first?.su?.name, "command request 000001");
  assert.equal(second?.su?.name, "command request 000001");
});

test("ratify resume preserves the request identity through the result audit", async () => {
  forget();
  const records = [];
  setExchangeRecorder({ runRoot: process.cwd(), record: sentence => records.push(sentence) });

  const sentence = {
    mood: "propose",
    be: "command",
    su: { name: "approval target" },
    ob: { text: "printf resumed; cat" }
  };
  const approval = await command(sentence);
  assert.equal(approval?.be, "ratify");
  const token = JSON.parse(approval.fromtext.text);
  assert.equal(token.requestIdentity, "command request 000001");

  const resumed = await withCommandResumeIdentity(
    token.requestIdentity,
    () => command({
      ...sentence,
      accordingto: { name: "ratify decision" },
      totext: { text: "truth" },
      fromtext: { text: "stdin payload" }
    })
  );
  assert.equal(resumed?.su?.name, "command request 000001");
  assert.match(String(resumed?.ob?.text ?? ""), /^resumed/u);
  assert.match(String(resumed?.ob?.text ?? ""), /stdin payload$/u);
  const audits = records.filter(record => record?.be === "command audit");
  assert.ok(audits.length >= 2);
  assert.ok(audits.every(record => record.to?.name === resumed.su.name));
});

test("malformed resume identity context is rejected instead of allocating a new request", async () => {
  forget();
  await assert.rejects(
    withCommandResumeIdentity("", () => command({
      be: "command",
      ob: { text: "printf malformed" }
    })),
    error => error?.sentence?.su?.name === "command resume defective"
  );
});
