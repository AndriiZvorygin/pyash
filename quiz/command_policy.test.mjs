import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { classifyCommandText, resolveCommandPolicy } from "../program/verbs/command.mjs";

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

