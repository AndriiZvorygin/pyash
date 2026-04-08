#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function usage() {
  return [
    "Usage: node command/migrate_existing_agenda_post_to_agenda_page.mjs <meeting_dir> [base_prefix] [post_ref] [dry_run]",
    "Example:",
    "  node command/migrate_existing_agenda_post_to_agenda_page.mjs world/house/grey-county-reporter/artifacts/grey-county/meetings/2026-03-05_agricultural-advisory-committee_69f891a9 meeting-qwen-auto 6068",
  ].join("\n");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "unknown";
}

function deriveDateInfo(meetingDir) {
  const name = path.basename(String(meetingDir || ""));
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return { iso: "" };
  return { iso: `${m[1]}-${m[2]}-${m[3]}` };
}

function safeReadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function upgradeAgendaHtmlToCanonical({ html, agendaUrl, transcriptUrl }) {
  let out = String(html || "");
  if (!out) return out;
  out = out.replace(/<link\s+rel=["']canonical["']\s+href=["'][^"']+["']\s*\/?>/iu, `<link rel="canonical" href="${agendaUrl}" />`);
  out = out.replace(/<meta\s+property=["']og:url["']\s+content=["'][^"']+["']\s*\/?>/iu, `<meta property="og:url" content="${agendaUrl}" />`);
  out = out.replace(/\/transcripts\//giu, "/agendas/");
  if (!/Transcript URL<\/dt>/iu.test(out) && /<section id=["']details["']/iu.test(out)) {
    out = out.replace(
      /(<section id=["']details["'][\s\S]*?<dl>)/iu,
      `$1\n        <dt>Transcript URL</dt><dd><a href="${transcriptUrl}">${transcriptUrl}</a></dd>`,
    );
  }
  if (!/Transcript will be published here:/iu.test(out) && /<section id=["']summary["']/iu.test(out)) {
    out = out.replace(
      /(<section id=["']summary["'][\s\S]*?<\/section>)/iu,
      `$1\n    <section><p>Transcript will be published here: <a href="${transcriptUrl}">${transcriptUrl}</a></p></section>`,
    );
  }
  return out;
}

function runWithStreaming({ cmd, args, cwd, env = {}, timeoutMs = 10 * 60 * 1000, label = "stage" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const t = String(chunk || "");
      stdout += t;
      process.stdout.write(t);
    });
    child.stderr.on("data", (chunk) => {
      const t = String(chunk || "");
      stderr += t;
      process.stderr.write(t);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(10_000, Number(timeoutMs) || 10_000));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? "null"} signal=${signal ?? ""})\n${stderr || stdout}`.trim()));
    });
  });
}

async function main() {
  const meetingDirArg = process.argv[2];
  const basePrefix = process.argv[3] || "meeting-qwen-auto";
  const postRef = process.argv[4] || "";
  const dryRun = /^(1|true|yes)$/iu.test(String(process.argv[5] || "0"));

  if (!meetingDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const meetingDir = path.resolve(process.cwd(), meetingDirArg);
  const transcriptDir = path.join(meetingDir, "transcript");
  const payloadPath = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.json`);
  if (!fs.existsSync(payloadPath)) {
    throw new Error(`payload not found: ${payloadPath}`);
  }
  const payload = safeReadJson(payloadPath, {});
  const meeting = safeReadJson(path.join(meetingDir, "meeting.json"), {});
  const srcPayload = meeting?.payload || {};

  const jurisdiction = String(payload?.jurisdiction || srcPayload?.jurisdiction || "").trim();
  const body = String(payload?.body || srcPayload?.meeting_name || "").trim();
  const dateInfo = deriveDateInfo(meetingDir);
  const dateIso = String(payload?.date_iso || dateInfo.iso || "").trim();
  if (!jurisdiction || !body || !dateIso) {
    throw new Error("cannot infer meeting identity (jurisdiction/body/date)");
  }

  const siteUrl = String(process.env.MEETING_PUBLISH_SITE_URL || "https://helpos.ca").replace(/\/+$/u, "");
  const agendaUrl = `${siteUrl}/agendas/${slugify(jurisdiction)}/${slugify(body)}/${dateIso}`;
  const transcriptUrl = `${siteUrl}/transcripts/${slugify(jurisdiction)}/${slugify(body)}/${dateIso}`;
  const officialSourceUrl = String(srcPayload?.meeting_url || payload?.source?.meeting_url || "").trim();
  const htmlPath = String(payload?.local_agenda_html || payload?.local_transcript_html || path.join(transcriptDir, "transcript-page.html")).trim();
  const hook = String(payload?.hook || "").trim();
  const title = String(payload?.title || `${hook ? `${hook} - ` : ""}${body} Agenda Preview - ${dateIso}`).trim();

  const bodyMarkdown = [
    `This page covers the upcoming ${jurisdiction} ${body} meeting for ${dateIso}.`,
    "",
    "Agenda page:",
    agendaUrl,
    "",
    officialSourceUrl ? `Official source:\n${officialSourceUrl}` : "",
    "",
    "Transcript will be published here:",
    transcriptUrl,
  ].filter(Boolean).join("\n");

  const htmlAbsPath = path.isAbsolute(htmlPath) ? htmlPath : path.resolve(path.dirname(payloadPath), htmlPath);
  const htmlSource = fs.readFileSync(htmlAbsPath, "utf8");
  const upgradedHtml = upgradeAgendaHtmlToCanonical({
    html: htmlSource,
    agendaUrl,
    transcriptUrl,
  });
  const migratedHtmlPath = path.join(transcriptDir, `${basePrefix}-normalized.agenda-page.migrated.html`);
  fs.writeFileSync(migratedHtmlPath, upgradedHtml, "utf8");

  const patch = {
    ...payload,
    title,
    body_markdown: bodyMarkdown,
    jurisdiction,
    body,
    date_iso: dateIso,
    agenda_url: agendaUrl,
    transcript_url: transcriptUrl,
    local_agenda_html: migratedHtmlPath,
    local_transcript_html: migratedHtmlPath,
    source: {
      ...(payload?.source || {}),
      meeting_url: officialSourceUrl || String(payload?.source?.meeting_url || ""),
    },
    content_type: "agenda",
    migrated_at_utc: new Date().toISOString(),
  };
  fs.writeFileSync(payloadPath, `${JSON.stringify(patch, null, 2)}\n`, "utf8");
  process.stdout.write(`[agenda-migrate] upgraded html: ${migratedHtmlPath}\n`);
  process.stdout.write(`[agenda-migrate] patched payload: ${payloadPath}\n`);
  process.stdout.write(`[agenda-migrate] identity: ${jurisdiction} | ${body} | ${dateIso}\n`);
  if (postRef) process.stdout.write(`[agenda-migrate] update post_ref: ${postRef}\n`);

  const idempotency = `agenda-migrate-${slugify(jurisdiction)}-${slugify(body)}-${dateIso}-${Date.now()}`;
  const args = [
    path.join("/home/htaf/pyash", "command/publish_agenda_to_helpos_from_payload.mjs"),
    payloadPath,
    String(process.env.AGENDA_PUBLISH_COMMUNITY_NAME || process.env.MEETING_PUBLISH_COMMUNITY_NAME || payload?.community_name || ""),
    idempotency,
    postRef,
    "",
    dryRun ? "1" : "0",
  ];
  await runWithStreaming({
    cmd: "node",
    args,
    cwd: "/home/htaf/pyash",
    label: "agenda-migrate-publish",
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
