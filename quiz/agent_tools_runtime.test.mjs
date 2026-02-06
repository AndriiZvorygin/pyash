import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

test("agent tools runtime (fixtures ok)", async () => {
  forget();
  const tmpRoot = path.resolve("/tmp/pyash-agent-tools-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await ensureDir(tmpRoot);

  doRemember({
    mood: "ya",
    su: { name: "agent cwd" },
    be: "cwd",
    ob: { filename: tmpRoot }
  });
  doRemember({
    mood: "ya",
    su: { name: "agent sandbox" },
    be: "truth",
    ob: { boolean: true }
  });

  process.env.PYA_COMMAND_RESPONSE = "cmd-ok";
  process.env.PYA_COMMAND_DEBUG = "lie";
  process.env.PYA_DOWNLOAD_RESPONSE = "downloaded";
  process.env.PYA_MIND_RESPONSE = "ok";

  try {
    // exists: create and check
    await fs.writeFile(path.join(tmpRoot, "exists.txt"), "ok", "utf8");
    const existsRes = await interpret(parse('be exists ob filename "exists.txt" do'));
    assert.equal(existsRes?.value?.bool, true);

    // write
    const writeRes = await interpret(parse('be write ob text "hello" to filename "note.txt" do'));
    assert.equal(writeRes?.value?.text, "hello");
    assert.equal(await readText(path.join(tmpRoot, "note.txt")), "hello");

    // list
    const listRes = await interpret(parse(`be list from filename "${tmpRoot}" do`));
    assert.ok(Array.isArray(listRes?.value?.ve?.values));
    assert.ok(listRes.value.ve.values.includes("note.txt"));

    // list files (same verb signature as tool map)
    const listFilesRes = await interpret(parse(`be list from filename "${tmpRoot}" do`));
    assert.ok(Array.isArray(listFilesRes?.value?.ve?.values));

    // read text
    const readRes = await interpret(parse('be read from filename "note.txt" do'));
    assert.equal(readRes?.value?.text, "hello");

    // read markdown
    await fs.writeFile(
      path.join(tmpRoot, "example.html"),
      "<p>Hello <a href=\"https://example.com\">Example</a></p>",
      "utf8"
    );
    const mdRes = await interpret(parse('be read from filename "example.html" fromstate wo html become wo markdown do'));
    assert.match(mdRes?.value?.text ?? "", /\[Example\]\(https:\/\/example\.com\)/);

    // command (fixture)
    const cmdRes = await interpret(parse('be command ob text "echo hello" to name text out do'));
    assert.equal(cmdRes?.value?.text, "cmd-ok");

    // download + search (fixtures)
    const downloadRes = await interpret(parse('be download from filename "https://example.com" as wo web to filename "downloaded.html" do'));
    assert.equal(await readText(path.join(tmpRoot, "downloaded.html")), "downloaded");
    assert.ok(downloadRes?.value?.filename);

    const searchFixturePath = path.join(tmpRoot, "search_fixture.json");
    await fs.writeFile(
      searchFixturePath,
      JSON.stringify({ results: [{ url: "https://example.com", title: "Example", content: "Example content" }] }),
      "utf8"
    );
    process.env.PYA_WEB_SEARCH_FIXTURE = searchFixturePath;
    const searchRes = await interpret(parse('be search ob text "example" fromstate wo web from filename "https://search.example" by num 1 do'));
    assert.ok(searchRes?.value?.map?.metadata);
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
    delete process.env.PYA_COMMAND_DEBUG;
    delete process.env.PYA_DOWNLOAD_RESPONSE;
    delete process.env.PYA_MIND_RESPONSE;
    delete process.env.PYA_WEB_SEARCH_FIXTURE;
  }
});
