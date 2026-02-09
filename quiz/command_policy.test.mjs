import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { command, classifyCommandText, resolveCommandPolicy } from "../program/verbs/command.mjs";

test("command classifier assigns stable classes", () => {
  assert.equal(classifyCommandText("cat README.md"), "read_only");
  assert.equal(classifyCommandText("echo hi > out.txt"), "write_local");
  assert.equal(classifyCommandText("curl -s https://example.com"), "network");
  assert.equal(classifyCommandText("kill -9 123"), "process_control");
  assert.equal(classifyCommandText("rm -rf /tmp/demo"), "destructive");
  assert.equal(classifyCommandText(""), "unknown");
});

test("command policy resolver reads command configure map", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo deny ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const denied = resolveCommandPolicy({
    sentence: { mood: "do" },
    cmdClass: "read_only"
  });
  assert.equal(denied.mode, "deny");
  assert.equal(denied.class, "read_only");

  const canSentence = resolveCommandPolicy({
    sentence: { mood: "can" },
    cmdClass: "read_only"
  });
  assert.equal(canSentence.mode, "deny", "can should not bypass deny policy");

  const proposeSentence = resolveCommandPolicy({
    sentence: { mood: "propose" },
    cmdClass: "read_only"
  });
  assert.equal(proposeSentence.mode, "ask");
});

test("command ask policy returns ratify for propose mood", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo ask ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const result = await command({
    mood: "propose",
    be: "command",
    su: { name: "run" },
    ob: { text: "echo hi" }
  });
  assert.equal(result?.mood, "do");
  assert.equal(result?.be, "ratify");
  assert.equal(result?.from?.name, "command");
  assert.equal(result?.accordingto?.name, "resume token");
  assert.ok(result?.fromtext?.text);
  assert.match(String(result?.ob?.text ?? ""), /approve command/i);
});

test("command ask policy returns ratify for destructive do mood", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo ask ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const result = await command({
    mood: "do",
    be: "command",
    ob: { text: "rm -rf /tmp/test" }
  });
  assert.equal(result?.mood, "do");
  assert.equal(result?.be, "ratify");
});

test("command approved resume bypasses ask gate once", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo ask ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const sentence = {
    mood: "propose",
    be: "command",
    su: { name: "run" },
    ob: { text: "cat" },
    fromtext: { text: "hi\n" }
  };
  const first = await command(sentence);
  assert.equal(first?.be, "ratify");

  const resumed = await command({
    ...sentence,
    accordingto: { name: "ratify decision" },
    totext: { text: "truth" }
  });
  assert.equal(resumed?.be, "command");
  assert.match(String(resumed?.ob?.text ?? ""), /hi/);
});

test("command sandbox blocks explicit network commands when disabled", async () => {
  forget();
  await interpret(parse("su name sandbox configure be map def"));
  await interpret(parse("su name network ob bool lie ya"));
  await interpret(parse("prah"));

  await assert.rejects(
    () => interpret(parse('be command ob text "curl -s https://example.com" do')),
    (err) => {
      const surfaced = err?.sentence;
      assert.equal(surfaced?.su?.name, "command sandbox defective");
      return true;
    }
  );
});
