import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`extractor exited ${code}: ${stderr || stdout}`));
    });
  });
}

test("eScribe attachment PDFs become item-specific subreports when text is meaningful", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-escribe-attachments-"));
  const outputDir = path.join(root, "subreports");
  const reportPs = path.join(root, "report.ps");
  const blankPs = path.join(root, "blank.ps");
  const reportPdf = path.join(root, "report.pdf");
  const blankPdf = path.join(root, "blank.pdf");
  fs.writeFileSync(reportPs, [
    "%!PS",
    "/Helvetica findfont 12 scalefont setfont",
    "72 720 moveto",
    "(River District calls increased 17 percent while weapons calls increased 320 percent.) show",
    "72 700 moveto",
    "(Attempted suicide calls increased 200 percent during the first five months of 2026.) show",
    "showpage",
  ].join("\n"), "utf8");
  fs.writeFileSync(blankPs, "%!PS\nshowpage\n", "utf8");
  execFileSync("ps2pdf", [reportPs, reportPdf]);
  execFileSync("ps2pdf", [blankPs, blankPdf]);

  const server = http.createServer((req, res) => {
    const file = req.url === "/report.pdf" ? reportPdf : blankPdf;
    res.writeHead(200, { "content-type": "application/pdf" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const agendaMd = path.join(root, "agenda.md");
  const agendaHtml = path.join(root, "agenda.html");
  const indexPath = path.join(root, "index.json");
  fs.writeFileSync(agendaMd, "CALL TO ORDER\n\nADJOURNMENT\n", "utf8");
  fs.writeFileSync(agendaHtml, [
    "<DIV class='AgendaItem AgendaItem11'>",
    "<DIV class='AgendaItemCounter'>5.a</DIV>",
    "<DIV class='AgendaItemTitle'><a tabindex='0'>River District Statistics Update</a></DIV>",
    `<DIV class='AgendaItemAttachment AgendaItemAttachment11'><a class='Link' href="http://127.0.0.1:${port}/report.pdf"><SPAN class='Link'>River District Statistics.pdf</SPAN></a></DIV>`,
    "</DIV>",
    "<DIV class='AgendaItem AgendaItem12'>",
    "<DIV class='AgendaItemCounter'>6.a</DIV>",
    "<DIV class='AgendaItemTitle'><a tabindex='0'>Scanned Correspondence</a></DIV>",
    `<DIV class='AgendaItemAttachment AgendaItemAttachment12'><a class='Link' href="http://127.0.0.1:${port}/blank.pdf"><SPAN class='Link'>Scanned Letter.pdf</SPAN></a></DIV>`,
    "</DIV>",
  ].join("\n"), "utf8");

  await runNode([
    path.join(process.cwd(), "command/extract_escribe_subreports.mjs"),
    agendaMd,
    outputDir,
    indexPath,
    agendaHtml,
    `http://127.0.0.1:${port}/meeting`,
    agendaMd,
  ], process.cwd());

  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const report = index.items.find((item) => item.item === "5.a");
  const blank = index.items.find((item) => item.item === "6.a");
  assert.equal(report.extraction_method, "attachment_pdf");
  assert.equal(report.has_page_slice, true);
  assert.match(fs.readFileSync(report.file, "utf8"), /weapons calls increased 320 percent/u);
  assert.equal(blank.has_page_slice, false);
  assert.equal(
    index.attachment_extraction_diagnostics
      .find((row) => row.item === "6.a")
      .attachments[0].status,
    "empty_or_image_only",
  );
});
