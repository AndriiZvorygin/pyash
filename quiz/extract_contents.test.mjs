import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const sampleHtml = `<!doctype html>
<html>
<head><title>Sample</title></head>
<body>
  <nav>
    <a href="#prev">Previous Transcript</a>
    <a href="#next">Next Transcript</a>
    <a href="#top">back-to-top</a>
  </nav>
  <main>
    <article>
      <h1>Balance of Love and Wisdom</h1>
      <p>This session asks how seekers may balance love and wisdom in service.</p>
      <p>Q'uo answers that the heart and intellect must be harmonized through lived practice.</p>
    </article>
  </main>
  <footer>dark mode</footer>
</body>
</html>`;

test("extract contents module returns main html contents from html file", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-extract-contents-"));
  const input = path.join(dir, "source.html");
  const output = path.join(dir, "contents.html");
  await fs.writeFile(input, sampleHtml, "utf8");

  await interpret(parse('from filename "./module/extract_contents.pya" ob name extract to name extract be import do'));
  await interpret(parse(`from filename ${JSON.stringify(input)} fromstate wo html become wo html as wo contents to filename ${JSON.stringify(output)} be extract do`));

  const text = await fs.readFile(output, "utf8");
  assert.match(text, /balance love and wisdom/i);
  assert.match(text, /Q'uo answers/i);
  assert.doesNotMatch(text, /Previous Transcript/);
});

test("extract contents module returns main html contents as text output", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-extract-contents-"));
  const input = path.join(dir, "source.html");
  await fs.writeFile(input, sampleHtml, "utf8");

  await interpret(parse('from filename "./module/extract_contents.pya" ob name extract to name extract be import do'));
  await interpret(parse(`from filename ${JSON.stringify(input)} fromstate wo html as wo contents to name text contents be extract do`));

  const contents = remember("contents");
  assert.equal(contents?.be, "text");
  assert.match(contents?.ob?.text ?? "", /<article>/i);
  assert.doesNotMatch(contents?.ob?.text ?? "", /Previous Transcript/);
});
