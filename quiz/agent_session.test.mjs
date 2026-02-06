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

function todayCompact() {
  return todayDate().replace(/-/g, "");
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("agent session writes append-only session file with system entry", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";

  const tmpRoot = path.resolve("/tmp/pyash-agent-session-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  doRemember({
    mood: "ya",
    be: "root",
    su: { name: "world root" },
    ob: { filename: tmpRoot }
  });

  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" from discourse "You are concise." ya'));
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name agent ob bool truth ya"));
    await interpret(parse('su name session name ob text "draft review" ya'));
    await interpret(parse("prah"));
    await interpret(parse('su name prompt ob text "Hello" for name helper to name text out with name tools be write do'));

    const sessionName = `${todayCompact()}-draft_review`;
    const sessionFile = path.join(tmpRoot, "house", "helper", "session", `${sessionName}.pya`);
    assert.ok(await exists(sessionFile));
    const content = await fs.readFile(sessionFile, "utf8");
    assert.match(content, new RegExp(`su name ${sessionName} since date ${todayDate()} be series def`));
    assert.match(content, /su name system ob text/);
    assert.match(content, /as name qwen3-vl:8b-instruct/);
    assert.match(content, /su name user ob text/);
    assert.match(content, /su name assistant ob text/);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
