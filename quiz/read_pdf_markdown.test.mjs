import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

const pdftohtmlAvailable = (() => {
  const res = spawnSync("pdftohtml", ["-h"], { stdio: "ignore" });
  return !res.error;
})();

const pandocAvailable = (() => {
  const res = spawnSync("pandoc", ["-v"], { stdio: "ignore" });
  return !res.error;
})();

function buildPdf({ text }) {
  const escaped = String(text).replace(/[()\\]/g, match => `\\${match}`);
  const content = `BT\n/F1 24 Tf\n72 120 Td\n(${escaped}) Tj\nET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

test("read pdf markdown extracts text", { skip: !(pdftohtmlAvailable && pandocAvailable) }, async () => {
  forget();
  const filename = "/tmp/pyash-read-pdf-md.pdf";
  const source = "Hello PDF";
  await fs.writeFile(filename, buildPdf({ text: source }));

  await run("ob name read from filename \"./module/read_pdf_markdown.pya\" to name read be import do");
  await run(`from filename \"${filename}\" fromstate wo pdf become wo markdown to name text out be read do`);
  const out = remember("out");
  assert.ok(out?.ob?.text?.includes("Hello"));
});
