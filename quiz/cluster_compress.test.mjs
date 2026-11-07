import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";

const fixtureNames = ["PYA_COMMAND_RESPONSE", "PYA_COMMAND_DEBUG", "PYA_ZIM_TOOL_LOG", "PYA_ZIM_TOOL_FAIL"];

async function writeExecutable(filename, lines) {
  await fs.writeFile(filename, ["#!/bin/sh", ...lines].join("\n"), "utf8");
  await fs.chmod(filename, 0o755);
}

async function withZimTools(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-workflow-"));
  const bin = path.join(root, "bin");
  await fs.mkdir(bin, { recursive: true });
  const log = path.join(root, "tool-calls.txt");
  const writer = path.join(bin, "zimwriterfs");
  const docker = path.join(bin, "docker");
  const zimdump = path.join(bin, "zimdump");
  const search = path.join(bin, "kiwix-search");

  await writeExecutable(writer, [
    'printf "zimwriterfs %s\\n" "$*" >> "$PYA_ZIM_TOOL_LOG"',
    'for arg do output="$arg"; done',
    'printf "fixture-zim" > "$output"',
    'printf "writer-created %s\\n" "$output"'
  ]);
  await writeExecutable(docker, [
    'printf "docker %s\\n" "$*" >> "$PYA_ZIM_TOOL_LOG"',
    'output=',
    'name=',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    *:/output) output="${1%:/output}" ;;',
    '    --name=*) name="${1#--name=}" ;;',
    '  esac',
    '  shift',
    'done',
    '[ "$PYA_ZIM_TOOL_FAIL" = "1" ] && exit 7',
    'mkdir -p "$output"',
    'printf "fixture-zim" > "$output/$name.zim"',
    'mkdir -p "$output/$name"',
    'printf "fixture-warc" > "$output/$name/capture.warc.gz"',
    'printf "zimit-created %s\\n" "$name"'
  ]);
  await writeExecutable(zimdump, [
    'printf "zimdump %s\\n" "$*" >> "$PYA_ZIM_TOOL_LOG"',
    'case "$*" in',
    '  *show*) printf "article body\\n" ;;',
    '  *) printf "index.html\\tHome\\narticle.html\\tArticle\\n" ;;',
    'esac'
  ]);
  await writeExecutable(search, [
    'printf "kiwix-search %s\\n" "$*" >> "$PYA_ZIM_TOOL_LOG"',
    'printf "article.html\\tArticle\\n"'
  ]);

  await fs.mkdir(path.join(root, "archives"));
  await fs.mkdir(path.join(root, "site"));
  await fs.writeFile(path.join(root, "site", "index.html"), "<h1>Fixture site</h1>", "utf8");
  await fs.writeFile(path.join(root, "plain.txt"), "plain text <article>", "utf8");
  await fs.writeFile(path.join(root, "capture.warc"), "fixture WARC", "utf8");

  const previousPath = process.env.PATH;
  const previousShell = process.env.SHELL;
  const previousFixtures = Object.fromEntries(fixtureNames.map((name) => [name, process.env[name]]));
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
  process.env.SHELL = "/bin/sh";
  process.env.PYA_ZIM_TOOL_LOG = log;
  delete process.env.PYA_COMMAND_RESPONSE;
  delete process.env.PYA_COMMAND_DEBUG;

  forget();
  doRemember(parse(`exists su name agent cwd ob filename ${JSON.stringify(root)} ya`));
  doRemember(parse("exists su name agent sandbox ob bool truth ya"));
  doRemember(parse("exists su name command policy mode ob wo allow ya"));
  doRemember(parse("exists su name command classifier enabled ob bool truth ya"));

  try {
    await run(root, log);
  } finally {
    forget();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShell;
    for (const [name, value] of Object.entries(previousFixtures)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("text files and HTML folders convert to ZIM through the existing write and cluster-compress verbs", async () => {
  await withZimTools(async (root, log) => {
    const textResult = await interpret(parse(
      'from filename "plain.txt" fromstate wo text tostate wo zim to filename "archives/text.zim" be cluster-compress do'
    ));
    assert.equal(textResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(textResult.ob.filename, "utf8"), "fixture-zim");

    const htmlResult = await interpret(parse(
      'from filename "site" fromstate wo html tostate wo zim to filename "archives/site.zim" be cluster-compress do'
    ));
    assert.equal(htmlResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(htmlResult.ob.filename, "utf8"), "fixture-zim");

    const writeResult = await interpret(parse(
      'ob filename "plain.txt" to filename "archives/write.zim" as wo cluster-compress be write do'
    ));
    assert.equal(writeResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(writeResult.ob.filename, "utf8"), "fixture-zim");

    const typedWriteResult = await interpret(parse(
      'from filename "site" fromstate wo html to filename "archives/typed-write.zim" as wo cluster-compress be write do'
    ));
    assert.equal(typedWriteResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(typedWriteResult.ob.filename, "utf8"), "fixture-zim");

    const inlineResult = await interpret(parse(
      'ob text "inline text" to filename "archives/inline.zim" as wo cluster-compress be write do'
    ));
    assert.equal(inlineResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(inlineResult.ob.filename, "utf8"), "fixture-zim");

    const calls = await fs.readFile(log, "utf8");
    assert.equal((calls.match(/^zimwriterfs /gmu) ?? []).length, 5);
    assert.match(calls, /--welcome=index\.html/u);
    assert.match(calls, /--illustration=pyash-archive-illustration\.png/u);
    assert.match(calls, /--name=write/u);
    assert.deepEqual(await fs.readdir(path.join(root, "site")), ["index.html"]);
    assert.ok(await fs.stat(path.join(root, "archives", "text.zim")));
  });
});

test("web capture retains the ZIM and WARC evidence, and WARC input uses the same conversion route", async () => {
  await withZimTools(async (root, log) => {
    const webResult = await interpret(parse(
      'from filename "https://example.org/" fromstate wo web tostate wo zim to filename "archives/web.zim" be cluster-compress do'
    ));
    assert.equal(webResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(webResult.ob.filename, "utf8"), "fixture-zim");
    assert.equal(await fs.readFile(webResult.warc.filename, "utf8"), "fixture-warc");
    assert.match(await fs.readFile(log, "utf8"), /--keep/u);
    assert.match(await fs.readFile(log, "utf8"), /--seeds=https:\/\/example\.org\//u);

    const warcResult = await interpret(parse(
      'from filename "capture.warc" fromstate wo warc tostate wo zim to filename "archives/warc.zim" be cluster-compress do'
    ));
    assert.equal(warcResult?.be, "cluster-compress");
    assert.equal(await fs.readFile(warcResult.ob.filename, "utf8"), "fixture-zim");
    const calls = await fs.readFile(log, "utf8");
    assert.match(calls, /warc2zim \/input\/capture\.warc/u);
    assert.ok(await fs.stat(path.join(root, "archives", "web.zim.capture")));
  });
});

test("read and search use the existing Pyash verbs for a ZIM archive", async () => {
  await withZimTools(async (root, log) => {
    await fs.writeFile(path.join(root, "archives", "library.zim"), "fixture-zim", "utf8");
    const listResult = await interpret(parse(
      'from filename "archives/library.zim" as wo cluster-compress be read do'
    ));
    assert.equal(listResult?.be, "read");
    assert.match(listResult?.ob?.text ?? "", /index\.html/u);

    const readResult = await interpret(parse(
      'from filename "archives/library.zim" as wo cluster-compress ob text "article.html" be read do'
    ));
    assert.equal(readResult?.be, "read");
    assert.equal(readResult?.ob?.text, "article body\n");

    const searchResult = await interpret(parse(
      'ob text "love" in filename "archives/library.zim" as wo cluster-compress be search do'
    ));
    assert.equal(searchResult?.be, "search");
    assert.equal(searchResult?.ob?.text, "article.html\tArticle\n");

    const calls = await fs.readFile(log, "utf8");
    assert.match(calls, /zimdump list --details/u);
    assert.match(calls, /zimdump show --url=article\.html/u);
    assert.match(calls, /kiwix-search archives\/library\.zim love/u);
  });
});

test("archive conversion rejects paths outside the agent working root and unsafe HTML symlinks", async () => {
  await withZimTools(async (root) => {
    const outside = path.join(path.dirname(root), "outside-zim-input.txt");
    await fs.writeFile(outside, "outside", "utf8");
    try {
      await assert.rejects(
      interpret(parse(`from filename ${JSON.stringify(outside)} fromstate wo text tostate wo zim to filename "archives/outside.zim" be cluster-compress do`)),
        /outside|under the command working directory/u
      );
    } finally {
      await fs.rm(outside, { force: true });
    }

    const externalTarget = path.join(path.dirname(root), "outside-output.zim");
    await assert.rejects(
      interpret(parse(`from text "content" fromstate wo text tostate wo zim to filename ${JSON.stringify(externalTarget)} be cluster-compress do`)),
      /outside|under the command working directory/u
    );

    const linkedFile = path.join(path.dirname(root), "outside-linked.html");
    await fs.writeFile(linkedFile, "external", "utf8");
    await fs.symlink(linkedFile, path.join(root, "site", "linked.html"));
    try {
      await assert.rejects(
        interpret(parse('from filename "site" fromstate wo html tostate wo zim to filename "archives/unsafe.zim" be cluster-compress do')),
        /symbolic links/u
      );
    } finally {
      await fs.rm(linkedFile, { force: true });
    }
  });
});

test("conversion refuses to overwrite an existing archive", async () => {
  await withZimTools(async (root) => {
    const existing = path.join(root, "archives", "kept.zim");
    await fs.writeFile(existing, "keep", "utf8");
    await assert.rejects(
      interpret(parse('from text "new" fromstate wo text tostate wo zim to filename "archives/kept.zim" be cluster-compress do')),
      /refuses to overwrite/u
    );
    assert.equal(await fs.readFile(existing, "utf8"), "keep");
  });
});

test("failed web and WARC conversions remove temporary staging directories", async () => {
  await withZimTools(async (root) => {
    process.env.PYA_ZIM_TOOL_FAIL = "1";
    try {
      await assert.rejects(
        interpret(parse('from filename "https://example.org/" fromstate wo web tostate wo zim to filename "archives/fail-web.zim" be cluster-compress do')),
        /command defective/u
      );
      await assert.rejects(
        interpret(parse('from filename "capture.warc" fromstate wo warc tostate wo zim to filename "archives/fail-warc.zim" be cluster-compress do')),
        /command defective/u
      );
    } finally {
      delete process.env.PYA_ZIM_TOOL_FAIL;
    }
    const entries = await fs.readdir(path.join(root, "archives"));
    assert.deepEqual(entries, []);
  });
});
