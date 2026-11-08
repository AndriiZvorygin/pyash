import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { resolveConfigBool, resolveConfigNum, resolveConfigText } from "../program/configure/env.mjs";
import { parseKiwixSearchResults } from "../program/library/zim_archive.mjs";

const fixtureNames = ["PYA_COMMAND_RESPONSE", "PYA_COMMAND_DEBUG", "PYA_ZIM_TOOL_LOG", "PYA_ZIM_TOOL_FAIL"];

test("Kiwix search RSS results retain archive, entry, title, and excerpt", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>Guide &amp; reference</title>
    <link>/content/pyash-guide/index.html</link>
    <description>A <b>Pyash</b> archive &amp; retrieval guide.</description>
    <book><title>Pyash guide</title></book>
  </item></channel></rss>`;

  assert.deepEqual(parseKiwixSearchResults(xml, {
    endpoint: "http://[::1]:8091",
    archives: [{ filename: "/repo/world/library/archive/pyash-guide.zim", relative: "world/library/archive/pyash-guide.zim" }]
  }), [{
    title: "Guide & reference",
    link: "http://[::1]:8091/content/pyash-guide/index.html",
    archiveId: "pyash-guide",
    archivePath: "world/library/archive/pyash-guide.zim",
    bookTitle: "Pyash guide",
    entry: "index.html",
    snippet: "A Pyash archive & retrieval guide."
  }]);
});

async function writeExecutable(filename, lines) {
  await fs.writeFile(filename, ["#!/bin/sh", ...lines].join("\n"), "utf8");
  await fs.chmod(filename, 0o755);
}

async function withZimTools(run, { captureNetworkEnabled = true } = {}) {
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
    'case "$*" in *"--entrypoint=chown"*) exit 0 ;; esac',
    'output=',
    'name=',
    'mode=zimit',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    *:/output) output="${1%:/output}" ;;',
    '    --name=*) name="${1#--name=}" ;;',
    '    warc2zim) mode=warc ;;',
    '  esac',
    '  shift',
    'done',
    '[ "$PYA_ZIM_TOOL_FAIL" = "1" ] && exit 7',
    'mkdir -p "$output"',
    'if [ "$mode" = "warc" ]; then',
    '  printf "fixture-zim" > "$output/$name.zim"',
    'else',
    '  mkdir -p "$output/$name"',
    '  printf "fixture-zim" > "$output/$name/$name.zim"',
    '  printf "fixture-warc" > "$output/$name/capture.warc.gz"',
    'fi',
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
  doRemember(parse(`su name sandbox configure be map def
  su name network ob bool lie ya
prah`));
  doRemember(parse(`exists su name web archive network ob bool ${captureNetworkEnabled ? "truth" : "lie"} be default ya`));
  doRemember(parse('exists su name web archive prefix ob text "prefix" be default ya'));
  doRemember(parse("exists su name web archive page maximum ob num 2000 be default ya"));
  doRemember(parse("exists su name web archive page timeout seconds ob num 90 be default ya"));
  doRemember(parse("exists su name web archive page interval seconds ob num 1 be default ya"));
  doRemember(parse("exists su name web archive duration maximum seconds ob num 3600 be default ya"));
  doRemember(parse("exists su name web archive size maximum bytes ob num 2147483648 be default ya"));
  doRemember(parse("exists su name web archive workers ob num 1 be default ya"));

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

test("default Pyash configuration enables bounded Zimit captures", async () => {
  const config = await fs.readFile(path.join(process.cwd(), "configure/default.pya"), "utf8");
  const captureFacts = config
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.startsWith("exists su name web archive "));
  assert.equal(captureFacts.length, 8);

  forget();
  try {
    for (const fact of captureFacts) doRemember(parse(fact));
    assert.equal(resolveConfigBool("web archive network"), true);
    assert.equal(resolveConfigText("web archive prefix"), "prefix");
    assert.equal(resolveConfigNum("web archive page maximum"), 2000);
    assert.equal(resolveConfigNum("web archive page timeout seconds"), 90);
    assert.equal(resolveConfigNum("web archive page interval seconds"), 1);
    assert.equal(resolveConfigNum("web archive duration maximum seconds"), 3600);
    assert.equal(resolveConfigNum("web archive size maximum bytes"), 2147483648);
    assert.equal(resolveConfigNum("web archive workers"), 1);
  } finally {
    forget();
  }
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
    assert.match(await fs.readFile(log, "utf8"), /--scopeType=prefix/u);
    assert.match(await fs.readFile(log, "utf8"), /--pageLimit=2000/u);
    assert.match(await fs.readFile(log, "utf8"), /--pageLoadTimeout=90/u);
    assert.match(await fs.readFile(log, "utf8"), /--pageExtraDelay=1/u);
    assert.match(await fs.readFile(log, "utf8"), /--timeHardLimit=3600/u);
    assert.match(await fs.readFile(log, "utf8"), /--sizeHardLimit=2147483648/u);
    assert.match(await fs.readFile(log, "utf8"), /--workers=1/u);
    assert.match(await fs.readFile(log, "utf8"), /docker run --rm --entrypoint=chown/u);
    assert.match(await fs.readFile(log, "utf8"), /--entrypoint=chown.* -R \d+:\d+ \/output/u);

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

test("web capture obeys its dedicated network permission", async () => {
  await withZimTools(async (root, log) => {
    await assert.rejects(
      interpret(parse('from filename "https://example.org/" fromstate wo web tostate wo zim to filename "archives/blocked.zim" be cluster-compress do')),
      /web-to-ZIM capture requires enabled network permission/u
    );
    assert.equal(await fs.readFile(log, "utf8").catch(() => ""), "");
    assert.deepEqual(await fs.readdir(path.join(root, "archives")), []);
  }, { captureNetworkEnabled: false });
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

test("ZIM reads follow the configured external library symlink and reject other outside links", async () => {
  await withZimTools(async (root) => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-external-store-"));
    const libraryAlias = path.join(root, "library");
    await fs.writeFile(path.join(storage, "guide.zim"), "fixture-zim", "utf8");
    await fs.symlink(storage, libraryAlias, "dir");
    doRemember(parse('exists su name zim archive library directory ob text "library" be default ya'));
    doRemember(parse(`exists su name zim archive service directory ob text ${JSON.stringify(storage)} be default ya`));

    try {
      const result = await interpret(parse(
        'from filename "library/guide.zim" as wo cluster-compress ob text "index.html" be read do'
      ));
      assert.equal(result?.be, "read");
      assert.equal(result?.ob?.text, "article body\n");

      const unrelatedStore = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-unrelated-store-"));
      await fs.writeFile(path.join(unrelatedStore, "outside.zim"), "fixture-zim", "utf8");
      await fs.symlink(unrelatedStore, path.join(root, "unrelated"), "dir");
      try {
        await assert.rejects(
          interpret(parse('from filename "unrelated/outside.zim" as wo cluster-compress be read do')),
          /outside|command roots/u
        );
      } finally {
        await fs.rm(unrelatedStore, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(storage, { recursive: true, force: true });
    }
  });
});

test("search through Pyash accepts a directory and searches its direct ZIM members", async () => {
  await withZimTools(async (root, log) => {
    await fs.writeFile(path.join(root, "archives", "first.zim"), "fixture-zim", "utf8");
    await fs.writeFile(path.join(root, "archives", "second.zim"), "fixture-zim", "utf8");
    await fs.mkdir(path.join(root, "archives", "nested"));
    await fs.writeFile(path.join(root, "archives", "nested", "ignored.zim"), "fixture-zim", "utf8");
    await fs.writeFile(path.join(root, "archives", "ignored.txt"), "not an archive", "utf8");

    const result = await interpret(parse(
      'ob text "love" in filename "archives" as wo cluster-compress be search do'
    ));

    assert.equal(result?.be, "search");
    assert.match(result?.ob?.text ?? "", /first\.zim[\s\S]*article\.html/u);
    assert.match(result?.ob?.text ?? "", /second\.zim[\s\S]*article\.html/u);
    assert.doesNotMatch(result?.ob?.text ?? "", /ignored\.zim|ignored\.txt/u);
    const calls = await fs.readFile(log, "utf8");
    assert.equal((calls.match(/^kiwix-search /gmu) ?? []).length, 2);
    assert.match(calls, /kiwix-search archives\/first\.zim love/u);
    assert.match(calls, /kiwix-search archives\/second\.zim love/u);
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

    const outsideLibrary = path.join(path.dirname(root), "outside-zim-library");
    await fs.mkdir(outsideLibrary);
    await fs.writeFile(path.join(outsideLibrary, "outside.zim"), "outside", "utf8");
    try {
      await assert.rejects(
        interpret(parse(`ob text "query" in filename ${JSON.stringify(outsideLibrary)} as wo cluster-compress be search do`)),
        /outside|under the command working directory/u
      );
    } finally {
      await fs.rm(outsideLibrary, { recursive: true, force: true });
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
