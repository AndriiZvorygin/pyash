import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled = /^(1|true|yes|truth)$/iu.test(process.env.PYA_ENABLE_ZIM_TOOLS ?? "");

test("ZIM setup remains opt-in when its environment switch is off", () => {
  const result = spawnSync("bash", ["command/setup_zim_tools.sh"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYA_ENABLE_ZIM_TOOLS: "false" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /setup skipped/u);
});

test("the built ZIM image writes, reads, and searches an archive", { skip: !enabled }, async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zim-image-"));
  const site = path.join(workspace, "site");
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  await fs.mkdir(site);
  await fs.writeFile(
    path.join(site, "index.html"),
    "<!doctype html><html><head><title>Image-built archive</title></head><body>mango container smoke</body></html>",
    "utf8"
  );
  await fs.copyFile(path.join(root, "containers/zim-tools/archive-illustration.png"), path.join(site, "illustration.png"));

  const run = (tool, args) => spawnSync("docker", [
    "run", "--rm", `--user=${uid}:${gid}`, `--mount=type=bind,src=${workspace},dst=/work`,
    "--workdir=/work", "pyash/zim-tools:ubuntu-24.04", tool, ...args
  ], { cwd: root, encoding: "utf8", timeout: 60_000 });

  try {
    const create = run("zimwriterfs", [
      "--welcome=index.html", "--illustration=illustration.png", "--language=eng",
      "--title=Image-built archive", "--description=Container smoke test",
      "--longDescription=Container smoke test", "--creator=Pyash", "--publisher=Pyash",
      "--name=image-smoke", "site", "image-smoke.zim"
    ]);
    assert.equal(create.status, 0, `${create.stdout}\n${create.stderr}`);

    const read = run("zimdump", ["show", "--url=index.html", "--", "image-smoke.zim"]);
    assert.equal(read.status, 0, `${read.stdout}\n${read.stderr}`);
    assert.match(read.stdout, /mango container smoke/u);

    const search = run("kiwix-search", ["image-smoke.zim", "mango"]);
    assert.equal(search.status, 0, `${search.stdout}\n${search.stderr}`);
    assert.match(search.stdout, /Image-built archive/u);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
