import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { buildToolSchemas, buildToolSentence, formatWebSearchToolResult } from "../program/verbs/mind/tooling.mjs";
import { mapSentenceToPyash } from "../program/verbs/exchange/json_map.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("web search returns map of found entries", async () => {
  forget();

  const fixturePath = path.join(repoRoot, "quiz", "fixtures", "web_search_fixture.json");
  await run(`exists su name web search fixture ob filename \"${fixturePath}\" be text ya`);
  await run("exists su name web search motor ob filename \"https://tsoc.liberit.ca/\" be default ya");

  await run("su name found ob text \"example\" fromstate wo web by num 2 be search do");

  const found = remember("found");
  assert.equal(found?.be, "map");
  const map = found?.ob?.map ?? {};
  assert.equal(found?.ob?.text, "example");
  assert.equal(found?.from?.filename, "https://tsoc.liberit.ca/");
  const meta = map.metadata;
  assert.equal(meta?.ob?.text, "example");
  assert.equal(meta?.from?.filename, "https://tsoc.liberit.ca/");

  const first = map["1"];
  assert.equal(first?.atindex?.num, 1);
  assert.equal(first?.from?.filename, "https://example.com/a");
  assert.equal(first?.ob?.text, "Example A");
  assert.equal(first?.as?.text, "Alpha summary");
  assert.equal(first?.fromstate?.text, "web");
  assert.equal(first?.via?.name, "searxng");
  const toolText = formatWebSearchToolResult(found);
  assert.match(toolText, /Web search status: RESPONSE RECEIVED/u);
  assert.match(toolText, /Result records returned: 2/u);
  assert.match(toolText, /URL: https:\/\/example\.com\/a/u);
});

test("web search keeps an explicit motor instead of applying a competing dynamic default", async () => {
  forget();

  const fixturePath = path.join(repoRoot, "quiz", "fixtures", "web_search_fixture.json");
  await run(`exists su name web search fixture ob filename \"${fixturePath}\" be text ya`);
  await run("exists su name web search motor ob filename \"https://tsoc.liberit.ca/\" be default ya");
  await run("su name found ob text \"explicit motor\" fromstate wo web by num 1 be search do");

  assert.equal(remember("found")?.from?.filename, "https://tsoc.liberit.ca/");
});

test("Yago agent API search posts authenticated Tavily-compatible requests", async (t) => {
  forget();
  const previousFixture = process.env.PYA_WEB_SEARCH_FIXTURE;
  delete process.env.PYA_WEB_SEARCH_FIXTURE;
  t.after(() => {
    if (previousFixture === undefined) delete process.env.PYA_WEB_SEARCH_FIXTURE;
    else process.env.PYA_WEB_SEARCH_FIXTURE = previousFixture;
  });

  let request = null;
  let requestCount = 0;
  let alwaysIncomplete = false;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = {
      method: req.method,
      url: new URL(req.url, "http://127.0.0.1"),
      authorization: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
    };
    requestCount += 1;
    if (alwaysIncomplete || requestCount === 1) {
      res.writeHead(409, { "content-type": "application/json", "retry-after": "0" });
      res.end(JSON.stringify({ detail: { error: "search unavailable: one or more search sources did not complete" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      query: "technology news",
      results: [{ title: "Tech report", url: "https://news.example/tech", content: "A recent technology story." }],
      response_time: 0.42
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  await run(`exists su name yago api key ob text "test-yago-key" be default ya`);
  await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));
  const capability = buildToolSchemas("saddle tools").toolMap.get("web_search_source");
  const endpoint = `http://127.0.0.1:${server.address().port}/search`;
  const call = buildToolSentence({
    capability,
    args: { query: "technology news", search_url: endpoint }
  });
  call.su = { name: "yago results" };
  await interpret(call);

  assert.equal(requestCount, 2);
  assert.equal(request.method, "POST");
  assert.equal(request.url.pathname, "/search");
  assert.equal(request.authorization, "Bearer test-yago-key");
  assert.deepEqual(request.body, { query: "technology news", max_results: 5 });
  const found = remember("yago results");
  assert.equal(found.ob.map.metadata.via.name, "yago");
  assert.equal(found.ob.map["1"].ob.text, "Tech report");
  assert.equal(found.ob.map["1"].from.filename, "https://news.example/tech");
  assert.equal(found.ob.map["1"].as.text, "A recent technology story.");
  const surfaced = formatWebSearchToolResult(found);
  assert.match(surfaced, /URL: https:\/\/news\.example\/tech/u);
  assert.doesNotMatch(surfaced, /test-yago-key/u);

  alwaysIncomplete = true;
  const incompleteCall = buildToolSentence({
    capability,
    args: { query: "technology news", search_url: endpoint }
  });
  incompleteCall.su = { name: "incomplete yago results" };
  await interpret(incompleteCall);
  assert.equal(requestCount, 4);
  const incomplete = remember("incomplete yago results");
  assert.equal(incomplete.ob.map.metadata.searchStatus.text, "incomplete");
  assert.match(incomplete.ob.map.metadata.searchIssues.text, /search sources did not complete/u);
  const incompleteText = formatWebSearchToolResult(incomplete);
  assert.match(incompleteText, /Web search status: INCOMPLETE/u);
  assert.match(incompleteText, /Result records returned: 0/u);
});

test("YaCy JSON API search returns source URLs and exposes incomplete federation status", async (t) => {
  forget();
  const previousFixture = process.env.PYA_WEB_SEARCH_FIXTURE;
  delete process.env.PYA_WEB_SEARCH_FIXTURE;
  t.after(() => {
    if (previousFixture === undefined) delete process.env.PYA_WEB_SEARCH_FIXTURE;
    else process.env.PYA_WEB_SEARCH_FIXTURE = previousFixture;
  });

  let requestUrl = null;
  let responsePayload = {
    complete: false,
    channels: [{
      totalResults: "34",
      partialFailures: [{ source: "peer-1", reason: "connection timed out at http://192.0.2.42:8090/search" }],
      items: [{
        title: "Technology report",
        link: "https://news.example/technology-report",
        description: "A source page about technology."
      }]
    }]
  };
  const server = createServer((req, res) => {
    requestUrl = new URL(req.url, "http://127.0.0.1");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(responsePayload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));
  const endpointCapability = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.name === "web_search_source");
  assert.ok(endpointCapability);
  const capability = buildToolSchemas("saddle tools").toolMap.get(endpointCapability.function.name);
  const endpoint = `http://127.0.0.1:${server.address().port}/yacysearch.json`;
  const call = buildToolSentence({
    capability,
    args: { query: "technology news", search_url: endpoint }
  });
  call.su = { name: "found" };
  await interpret(call);

  assert.equal(requestUrl.pathname, "/yacysearch.json");
  assert.equal(requestUrl.searchParams.get("query"), "technology news");
  assert.equal(requestUrl.searchParams.get("maximumRecords"), "5");
  assert.equal(requestUrl.searchParams.get("contentdom"), "text");
  const found = remember("found");
  assert.equal(found.be, "map");
  assert.equal(found.from.filename, endpoint);
  assert.equal(found.ob.map.metadata.as.text, "Search status: partial; 1 result returned; reported total: 34; issues: search peer timed out");
  assert.doesNotMatch(found.ob.map.metadata.as.text, /192\.0\.2\.42/u);
  assert.equal(found.ob.map["1"].from.filename, "https://news.example/technology-report");
  assert.equal(found.ob.map["1"].ob.text, "Technology report");
  assert.equal(found.ob.map["1"].as.text, "A source page about technology.");
  assert.equal(found.ob.map["1"].via.name, "yacy");
  const surfacedText = mapSentenceToPyash(found);
  assert.match(surfacedText, /Search status: partial/u);
  assert.match(surfacedText, /https:\/\/news\.example\/technology-report/u);
  const modelToolText = formatWebSearchToolResult(found);
  assert.match(modelToolText, /Web search status: PARTIAL/u);
  assert.match(modelToolText, /Technology report/u);
  assert.match(modelToolText, /URL: https:\/\/news\.example\/technology-report/u);

  responsePayload = {
    complete: false,
    channels: [{
      totalResults: "0",
      partialFailures: [{ source: "local-search", reason: "local search deadline exceeded" }],
      items: []
    }]
  };
  const emptyCall = buildToolSentence({
    capability,
    args: { query: "technology news", search_url: endpoint }
  });
  emptyCall.su = { name: "empty found" };
  await interpret(emptyCall);
  const empty = remember("empty found");
  assert.equal(empty.ob.map.metadata.searchStatus.text, "incomplete");
  const emptyToolText = formatWebSearchToolResult(empty);
  assert.match(emptyToolText, /Web search status: INCOMPLETE/u);
  assert.match(emptyToolText, /Result records returned: 0/u);
  assert.match(emptyToolText, /No result records were returned; this response contains no titles or source URLs/u);
  assert.match(emptyToolText, /local search timed out/u);
});
