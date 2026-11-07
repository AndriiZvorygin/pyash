import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";

const enabled = /^(1|true|yes|truth)$/iu.test(process.env.PYA_ENABLE_ZIM_TOOLS ?? "");
const fixtureNames = ["PYA_COMMAND_RESPONSE"];

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startKiwixServer(archives) {
  const port = await freePort();
  const child = spawn("kiwix-serve", ["--address=127.0.0.1", "--port", String(port), ...archives], {
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const endpoint = `http://127.0.0.1:${port}`;
  let available = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(300) });
      if (response.ok) {
        available = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!available) {
    child.kill("SIGTERM");
    throw new Error(`kiwix-serve did not start: ${stderr}`);
  }
  return { child, endpoint };
}

test("installed ZIM tools create, read, and full-text search a real archive and archive directory", { skip: !enabled }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-live-"));
  const site = path.join(root, "site");
  const secondSite = path.join(root, "second-site");
  const library = path.join(root, "library");
  const previousFixtures = Object.fromEntries(fixtureNames.map((name) => [name, process.env[name]]));
  const previousShell = process.env.SHELL;
  let kiwixServer;
  await fs.mkdir(site);
  await fs.mkdir(secondSite);
  await fs.mkdir(library);
  await fs.writeFile(
    path.join(site, "index.html"),
    "<!doctype html><html><head><title>Offline test</title></head><body>cobalt archive retrieval proof</body></html>",
    "utf8"
  );
  await fs.writeFile(
    path.join(secondSite, "index.html"),
    "<!doctype html><html><head><title>Pyash guide</title></head><body>saffron library lookup proof</body></html>",
    "utf8"
  );

  for (const name of fixtureNames) delete process.env[name];
  process.env.SHELL = "/bin/sh";
  forget();
  doRemember(parse(`exists su name agent cwd ob filename ${JSON.stringify(root)} ya`));
  doRemember(parse("exists su name agent sandbox ob bool truth ya"));
  doRemember(parse("exists su name command policy mode ob wo allow ya"));
  doRemember(parse("exists su name command classifier enabled ob bool truth ya"));
  doRemember(parse('exists su name zim archive default language ob text "eng" be default ya'));
  doRemember(parse('exists su name zim archive library directory ob text "library" be default ya'));

  try {
    const created = await interpret(parse(
      'from filename "site" fromstate wo html tostate wo zim to filename "offline.zim" be cluster-compress do'
    ));
    assert.equal(created?.be, "cluster-compress");
    assert.ok((await fs.stat(path.join(root, "offline.zim"))).size > 0);

    const secondCreated = await interpret(parse(
      'from filename "second-site" fromstate wo html tostate wo zim to filename "library/pyash-guide.zim" be cluster-compress do'
    ));
    assert.equal(secondCreated?.be, "cluster-compress");
    await fs.copyFile(path.join(root, "offline.zim"), path.join(library, "offline.zim"));

    kiwixServer = await startKiwixServer([
      path.join(library, "pyash-guide.zim"),
      path.join(library, "offline.zim")
    ]);
    doRemember(parse(`exists su name zim archive search server ob text ${JSON.stringify(kiwixServer.endpoint)} be default ya`));

    const read = await interpret(parse(
      'from filename "offline.zim" as wo cluster-compress ob text "index.html" be read do'
    ));
    assert.equal(read?.be, "read");
    assert.match(read?.ob?.text ?? "", /cobalt archive retrieval proof/u);

    const search = await interpret(parse(
      'ob text "cobalt" in filename "offline.zim" as wo cluster-compress be search do'
    ));
    assert.equal(search?.be, "search");
    assert.match(search?.ob?.text ?? "", /Offline test/u);

    const librarySearch = await interpret(parse(
      'ob text "saffron" in filename "library" as wo cluster-compress be search do'
    ));
    assert.equal(librarySearch?.be, "search");
    assert.match(librarySearch?.ob?.text ?? "", /archive: library\/pyash-guide\.zim/u);
    assert.match(librarySearch?.ob?.text ?? "", /title: Pyash guide/u);
    assert.match(librarySearch?.ob?.text ?? "", /entry: index\.html/u);
    assert.match(librarySearch?.ob?.text ?? "", /snippet: saffron library lookup proof/u);

    const archiveSearch = await interpret(parse(
      'ob text "saffron" in filename "library/pyash-guide.zim" as wo cluster-compress be search do'
    ));
    assert.equal(archiveSearch?.be, "search");
    assert.match(archiveSearch?.ob?.text ?? "", /archive: library\/pyash-guide\.zim/u);
    assert.match(archiveSearch?.ob?.text ?? "", /snippet: saffron library lookup proof/u);
    assert.doesNotMatch(archiveSearch?.ob?.text ?? "", /offline\.zim/u);

    const retrieved = await interpret(parse(
      'from filename "library/pyash-guide.zim" as wo cluster-compress ob text "index.html" be read do'
    ));
    assert.equal(retrieved?.be, "read");
    assert.match(retrieved?.ob?.text ?? "", /saffron library lookup proof/u);
  } finally {
    if (kiwixServer?.child && kiwixServer.child.exitCode === null) {
      kiwixServer.child.kill("SIGTERM");
      await new Promise((resolve) => kiwixServer.child.once("exit", resolve));
    }
    forget();
    if (previousShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShell;
    for (const [name, value] of Object.entries(previousFixtures)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
