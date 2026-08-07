import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSupportingAttachmentMirrorPlan,
  findUnmirroredSupportingAttachmentUrls,
  mirrorSupportingAttachments,
  rewriteSupportingAttachmentUrls,
} from "../program/library/reporter_shared/supporting-attachment-mirror.mjs";

function fixtureMeeting() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attachment-mirror-"));
  const converted = path.join(root, "converted");
  const subreports = path.join(converted, "subreports");
  const attachmentDir = path.join(subreports, "_attachments");
  const transcript = path.join(root, "transcript");
  fs.mkdirSync(attachmentDir, { recursive: true });
  fs.mkdirSync(transcript, { recursive: true });
  const localFile = path.join(attachmentDir, "7-a-1-presentation-pdf.pdf");
  fs.writeFileSync(localFile, Buffer.from("%PDF-1.4\nfixture\n", "utf8"));
  const sourceUrl = "https://pub-owensound.escribemeetings.com/filestream.ashx?DocumentId=123";
  const indexPath = path.join(converted, "subreports.index.json");
  fs.writeFileSync(indexPath, JSON.stringify({
    schema_version: "canonical_escribe_agenda_v2",
    items: [{
      item: "7.a",
      title: "Presentation",
      file: path.join(subreports, "7-a_presentation.md"),
      attachments: [{ label: "Presentation.pdf", url: sourceUrl }],
      attachment_diagnostics: [{ label: "Presentation.pdf", url: sourceUrl, status: "extracted" }],
    }],
  }), "utf8");
  return { root, transcript, indexPath, localFile, sourceUrl };
}

test("mirror plan maps canonical attachment URLs to retained local files", () => {
  const fixture = fixtureMeeting();
  const plan = buildSupportingAttachmentMirrorPlan({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].sourceUrl, fixture.sourceUrl);
  assert.equal(plan[0].localPath, fixture.localFile);
  assert.equal(plan[0].item, "7.a");
  assert.equal(plan[0].contentType, "application/pdf");
  assert.equal(plan[0].sha256, crypto.createHash("sha256").update(fs.readFileSync(fixture.localFile)).digest("hex"));
});

test("mirror plan prefers explicit local_file metadata", () => {
  const fixture = fixtureMeeting();
  const index = JSON.parse(fs.readFileSync(fixture.indexPath, "utf8"));
  const explicit = path.join(path.dirname(fixture.localFile), "retained-original.pdf");
  fs.writeFileSync(explicit, Buffer.from("%PDF-1.4\nexplicit\n", "utf8"));
  index.items[0].attachment_diagnostics[0].local_file = explicit;
  fs.writeFileSync(fixture.indexPath, JSON.stringify(index), "utf8");
  const plan = buildSupportingAttachmentMirrorPlan({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
  });
  assert.equal(plan[0].localPath, explicit);
});

test("mirror plan includes retained agenda package source documents", () => {
  const fixture = fixtureMeeting();
  const packageUrl = "https://pub-owensound.escribemeetings.com/FileStream.ashx?DocumentId=999";
  const packageFile = path.join(fixture.root, "source", "agenda-01.pdf");
  fs.mkdirSync(path.dirname(packageFile), { recursive: true });
  fs.writeFileSync(packageFile, Buffer.from("%PDF-1.4\nagenda package\n", "utf8"));
  const plan = buildSupportingAttachmentMirrorPlan({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
    sourceAttachments: [{
      item: "agenda-source",
      label: "Official agenda package",
      url: packageUrl,
      local_file: packageFile,
    }],
  });
  assert.equal(plan.length, 2);
  assert.equal(plan[1].sourceUrl, packageUrl);
  assert.equal(plan[1].localPath, packageFile);
});

test("rewriter replaces the source URL in Markdown and HTML", () => {
  const sourceUrl = "https://pub-owensound.escribemeetings.com/filestream.ashx?DocumentId=123";
  const mirrorUrl = "https://helpos.ca/attachments/abc/presentation.pdf";
  const input = `[PDF](${sourceUrl}) <a href="${sourceUrl}">PDF</a>`;
  const output = rewriteSupportingAttachmentUrls(input, new Map([[sourceUrl, mirrorUrl]]));
  assert.equal(output, `[PDF](${mirrorUrl}) <a href="${mirrorUrl}">PDF</a>`);
});

test("unmirrored attachment detector catches HTML-encoded eScribe file links", () => {
  const urls = findUnmirroredSupportingAttachmentUrls(
    '<a href="https://pub.example.escribemeetings.com/filestream.ashx?DocumentId=123&amp;Inline=true">PDF</a>',
  );
  assert.deepEqual(urls, [
    "https://pub.example.escribemeetings.com/filestream.ashx?DocumentId=123&Inline=true",
  ]);
});

test("mirror plan fails when a canonical attachment has no retained local copy", () => {
  const fixture = fixtureMeeting();
  fs.unlinkSync(fixture.localFile);
  assert.throws(() => buildSupportingAttachmentMirrorPlan({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
  }), /retained local copy/u);
});

test("mirror upload returns a rewrite mapping and persists a reusable manifest", async () => {
  const fixture = fixtureMeeting();
  const responsePath = path.join(fixture.transcript, "mirror-response.json");
  let calls = 0;
  const fetchImpl = async (_url, request) => {
    calls += 1;
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, "Bearer test-token");
    assert.ok(request.body instanceof FormData);
    const metadata = JSON.parse(request.body.get("metadata"));
    assert.equal(metadata.original_url, fixture.sourceUrl);
    assert.equal(metadata.idempotency_key, `attachment-${metadata.sha256}`);
    return new Response(JSON.stringify({
      mirror_url: "https://helpos.ca/attachments/abc/presentation.pdf",
    }), { status: 200 });
  };

  const first = await mirrorSupportingAttachments({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
    token: "test-token",
    jurisdiction: "Owen Sound",
    body: "Council",
    dateIso: "2026-07-27",
    responsePath,
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.equal(first.mapping.get(fixture.sourceUrl), "https://helpos.ca/attachments/abc/presentation.pdf");
  assert.ok(fs.existsSync(responsePath));

  const second = await mirrorSupportingAttachments({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
    token: "test-token",
    responsePath,
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.equal(second.responses[0].cached, true);
});

test("mirror upload fails closed when the server endpoint is unavailable", async () => {
  const fixture = fixtureMeeting();
  await assert.rejects(() => mirrorSupportingAttachments({
    payloadDir: fixture.transcript,
    attachmentIndexPath: fixture.indexPath,
    token: "test-token",
    fetchImpl: async () => new Response("not found", { status: 404 }),
  }), /attachment mirror failed \(404\)/u);
});
