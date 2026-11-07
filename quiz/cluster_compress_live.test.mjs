import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";

const enabled = /^(1|true|yes|truth)$/iu.test(process.env.PYA_ENABLE_ZIM_TOOLS ?? "");
const fixtureNames = ["PYA_COMMAND_RESPONSE"];

test("installed ZIM tools create, read, and full-text search a real archive and archive directory", { skip: !enabled }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-live-"));
  const site = path.join(root, "site");
  const secondSite = path.join(root, "second-site");
  const library = path.join(root, "library");
  const previousFixtures = Object.fromEntries(fixtureNames.map((name) => [name, process.env[name]]));
  const previousShell = process.env.SHELL;
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
    assert.match(librarySearch?.ob?.text ?? "", /pyash-guide\.zim[\s\S]*Pyash guide/u);
  } finally {
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
