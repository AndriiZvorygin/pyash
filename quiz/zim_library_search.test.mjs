import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { searchZimArchive } from "../program/library/zim_archive.mjs";

test("shared Kiwix search scopes multilingual libraries to the configured default language", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-search-"));
  const project = path.join(root, "project");
  const world = path.join(project, "world");
  const library = path.join(world, "library", "archive");
  await fs.mkdir(library, { recursive: true });
  const facts = new Map([
    ["run root", { ob: { filename: path.join(root, "pyash-runtime") } }],
    ["world root", { ob: { filename: world } }],
    ["sandbox configure", { ob: { map: {
      cwd: { filename: project },
      "writable roots": { ve: { values: [project] } }
    } } }],
    ["zim archive library directory", { ob: { text: "world/library/archive" } }],
    ["zim archive search server", { ob: { text: "https://zim.zvorygin.ca" } }],
    ["zim archive default language", { ob: { text: "eng" } }]
  ]);
  const remember = (name) => facts.get(name) ?? null;
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    return new Response(`<rss><channel><item>
      <title>Technology news</title>
      <link>/content/wikipedia_en_all/Technology_news</link>
      <description>Technology reporting and analysis.</description>
      <book><title>Wikipedia</title></book>
    </item></channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
  };
  try {
    const result = await searchZimArchive({
      mood: "do",
      be: "search",
      in: { filename: "world/library/archive" },
      ob: { text: "technology news" }
    }, { remember });

    assert.equal(requestedUrl.pathname, "/search");
    assert.equal(requestedUrl.searchParams.get("pattern"), "technology news");
    assert.equal(requestedUrl.searchParams.get("books.filter.lang"), "eng");
    assert.equal(requestedUrl.searchParams.get("format"), "xml");
    assert.match(result.ob.text, /title: Technology news/u);
    assert.match(result.ob.text, /page: https:\/\/zim\.zvorygin\.ca\/content\/wikipedia_en_all\/Technology_news/u);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});
