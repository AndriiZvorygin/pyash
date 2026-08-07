#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readPyaTextValues } from "./pya_lookup.mjs";
import {
  buildSupportingAttachmentMirrorPlan,
  DEFAULT_ATTACHMENT_ENDPOINT,
  mirrorSupportingAttachments,
  rewriteSupportingAttachmentUrls,
} from "../program/library/reporter_shared/supporting-attachment-mirror.mjs";

const DEFAULT_ENDPOINT = "https://helpos.ca/api/helpos/v1/agenda-publish";

function usage() {
  return [
    "Usage: node command/publish_agenda_to_helpos_from_payload.mjs <payload_json> [community_name] [idempotency_key] [post_ref] [extras_json] [dry_run]",
    "Examples:",
    "  node command/publish_agenda_to_helpos_from_payload.mjs transcript/meeting-qwen-auto-normalized.lemmy-post.json grey-county-council",
    "  node command/publish_agenda_to_helpos_from_payload.mjs transcript/...lemmy-post.json grey-county-council grey-committee-2026-03-05-v2 https://helpos.ca/c/grey-county-council/6068/...",
  ].join("\n");
}

function parseDotEnvText(src) {
  const out = {};
  for (const rawLine of String(src || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseDotEnvText(fs.readFileSync(filePath, "utf8"));
}

function loadEnvFallbacks(cwdDir) {
  const merged = {};
  let cur = path.resolve(cwdDir);
  while (true) {
    Object.assign(merged, readEnvFileIfExists(path.join(cur, ".env")));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return merged;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "unknown";
}

function resolveMaybeRelative(baseDir, rawPath) {
  const p = String(rawPath || "").trim();
  if (!p) return "";
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}

function assertPathWithin(baseDir, targetPath, label = "path") {
  const resolvedBase = path.resolve(String(baseDir || ""));
  const resolvedTarget = path.resolve(String(targetPath || ""));
  const base = fs.realpathSync.native(resolvedBase);
  const target = fs.realpathSync.native(resolvedTarget);
  const rel = path.relative(base, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} must stay inside payload directory: target=${target} base=${base}`);
  }
}

function parsePostRef(postRefRaw) {
  const postRef = String(postRefRaw || "").trim();
  if (!postRef) return { post_id: "", post_url: "" };
  if (/^\d+$/u.test(postRef)) return { post_id: String(Number(postRef)), post_url: "" };
  if (/^https?:\/\//iu.test(postRef)) return { post_id: "", post_url: postRef };
  return { post_id: "", post_url: "" };
}

function parseRetryAfterMs(headerValue) {
  const raw = String(headerValue || "").trim();
  if (!raw) return 0;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return 0;
  return Math.max(0, when - Date.now());
}

function isRateLimited(status, parsedBody) {
  if (Number(status) === 429) return true;
  const err = String(parsedBody?.error || "").trim().toLowerCase();
  return err === "rate_limit_error";
}

function withAttemptSuffix(idempotencyKeyBase, attempt) {
  const base = String(idempotencyKeyBase || "").trim();
  if (!base) return "";
  const n = Number(attempt) || 1;
  return n <= 1 ? base : `${base}-r${n}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function buildIdempotencyKey({ jurisdiction, body, dateIso, postTitle, postBody, explicit }) {
  const ex = String(explicit || "").trim();
  if (ex) return ex;
  const base = `${slugify(jurisdiction)}-${slugify(body)}-${String(dateIso || "").trim() || "unknown-date"}-agenda`;
  const digest = crypto
    .createHash("sha256")
    .update(`${String(postTitle || "")}\n${String(postBody || "")}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `${base}-${digest}-v1`;
}

function toAgendaUrl(siteUrl, jurisdiction, body, dateIso) {
  return `${String(siteUrl || "https://helpos.ca").replace(/\/+$/u, "")}/agendas/${slugify(jurisdiction)}/${slugify(body)}/${dateIso}`;
}

function extractCanonicalHref(html) {
  const m = String(html || "").match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/iu);
  return m ? String(m[1]).trim() : "";
}

function hasMetaDescription(html) {
  return /<meta\s+name=["']description["']\s+content=["'][^"']+["']/iu.test(String(html || ""));
}

function hasTitleTag(html) {
  return /<title>[\s\S]*?<\/title>/iu.test(String(html || ""));
}

function stripDisallowedTags(html) {
  let out = String(html || "");
  out = out.replace(/<script\b[\s\S]*?<\/script>/giu, "");
  out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/giu, "");
  out = out.replace(/<object\b[\s\S]*?<\/object>/giu, "");
  out = out.replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/giu, "");
  return out;
}

function parseExtras(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return null;
  if (txt.startsWith("@")) {
    const fp = path.resolve(process.cwd(), txt.slice(1));
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  }
  return JSON.parse(txt);
}

function readSecretValues(cwdDir) {
  const here = path.resolve(cwdDir);
  const candidates = [
    path.join(here, "configure/secret.pya"),
    path.join(path.resolve(here, ".."), "configure/secret.pya"),
    path.join(path.resolve(here, "../.."), "configure/secret.pya"),
    path.join(path.resolve(here, "../../.."), "configure/secret.pya"),
  ];
  const secretPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  return readPyaTextValues(secretPath, [
    "agenda publish auth token",
    "meeting publish auth token",
    "agenda publish community name",
    "meeting publish community name",
    "meeting publish site url",
    "agenda publish site url",
    "grey county reporter username",
    "grey county reporter password",
    "owen sound reporter username",
    "owen sound reporter password",
  ]);
}

async function main() {
  const payloadArg = process.argv[2];
  const communityArg = process.argv[3] || "";
  const idempotencyArg = process.argv[4] || "";
  const postRefArg = process.argv[5] || "";
  const extrasArg = process.argv[6] || "";
  const dryRunArg = process.argv[7] || "";

  if (!payloadArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const envFallback = loadEnvFallbacks(process.cwd());
  const secret = readSecretValues(process.cwd());
  const endpoint = String(process.env.AGENDA_PUBLISH_ENDPOINT || DEFAULT_ENDPOINT).trim();
  const token = String(
    process.env.AGENDA_PUBLISH_AUTH_TOKEN
    || envFallback.AGENDA_PUBLISH_AUTH_TOKEN
    || process.env.MEETING_PUBLISH_AUTH_TOKEN
    || envFallback.MEETING_PUBLISH_AUTH_TOKEN
    || secret["agenda publish auth token"]
    || secret["meeting publish auth token"]
    || ""
  ).trim();
  const dryRun = /^(1|true|yes)$/iu.test(String(process.env.AGENDA_PUBLISH_DRY_RUN || dryRunArg || "0"));

  const payloadPath = path.resolve(process.cwd(), payloadArg);
  const payloadDir = path.dirname(payloadPath);
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

  const jurisdiction = String(payload?.jurisdiction || "").trim();
  const body = String(payload?.body || "").trim();
  const dateIso = String(payload?.date_iso || "").trim();
  const postTitle = String(payload?.title || "").trim();
  let postBody = String(payload?.body_markdown || "").trim();
  const suffix = String(payload?.suffix || "").trim();
  const transcriptUrl = String(payload?.transcript_url || "").trim();
  const officialSourceUrl = String(payload?.source?.meeting_url || payload?.meeting_url || "").trim();

  if (!jurisdiction || !body || !dateIso || !postTitle || !postBody) {
    throw new Error("payload missing required fields: jurisdiction/body/date_iso/title/body_markdown");
  }

  const communityName = String(
    process.env.AGENDA_PUBLISH_COMMUNITY_NAME
    || envFallback.AGENDA_PUBLISH_COMMUNITY_NAME
    || process.env.MEETING_PUBLISH_COMMUNITY_NAME
    || envFallback.MEETING_PUBLISH_COMMUNITY_NAME
    || secret["agenda publish community name"]
    || secret["meeting publish community name"]
    || communityArg
    || payload?.community_name
    || ""
  ).trim();

  const siteUrl = String(
    process.env.AGENDA_PUBLISH_SITE_URL
    || envFallback.AGENDA_PUBLISH_SITE_URL
    || process.env.MEETING_PUBLISH_SITE_URL
    || envFallback.MEETING_PUBLISH_SITE_URL
    || secret["agenda publish site url"]
    || secret["meeting publish site url"]
    || "https://helpos.ca"
  ).trim();

  const publishUsername = String(
    process.env.AGENDA_PUBLISH_USERNAME
    || envFallback.AGENDA_PUBLISH_USERNAME
    || process.env.MEETING_PUBLISH_USERNAME
    || envFallback.MEETING_PUBLISH_USERNAME
    || process.env.GREY_COUNTY_REPORTER_USERNAME
    || envFallback.GREY_COUNTY_REPORTER_USERNAME
    || process.env.OWEN_SOUND_REPORTER_USERNAME
    || envFallback.OWEN_SOUND_REPORTER_USERNAME
    || secret["grey county reporter username"]
    || secret["owen sound reporter username"]
    || payload?.publish_username
    || payload?.metadata?.publish_username
    || ""
  ).trim();
  const publishPassword = String(
    process.env.AGENDA_PUBLISH_PASSWORD
    || envFallback.AGENDA_PUBLISH_PASSWORD
    || process.env.MEETING_PUBLISH_PASSWORD
    || envFallback.MEETING_PUBLISH_PASSWORD
    || process.env.GREY_COUNTY_REPORTER_PASSWORD
    || envFallback.GREY_COUNTY_REPORTER_PASSWORD
    || process.env.OWEN_SOUND_REPORTER_PASSWORD
    || envFallback.OWEN_SOUND_REPORTER_PASSWORD
    || secret["grey county reporter password"]
    || secret["owen sound reporter password"]
    || payload?.publish_password
    || payload?.metadata?.publish_password
    || ""
  ).trim();

  const postRefEnv = String(process.env.AGENDA_PUBLISH_POST_REF || envFallback.AGENDA_PUBLISH_POST_REF || "").trim();
  const parsedRef = parsePostRef(postRefEnv || postRefArg || payload?.post_id || payload?.post_url || "");
  const updateMode = Boolean(parsedRef.post_id || parsedRef.post_url);
  if (!updateMode && !communityName) {
    throw new Error("CREATE mode requires community_name (arg2 or AGENDA_PUBLISH_COMMUNITY_NAME)");
  }

  const htmlSourcePath = resolveMaybeRelative(payloadDir, payload?.local_agenda_html || payload?.local_transcript_html);
  if (!htmlSourcePath || !fs.existsSync(htmlSourcePath)) {
    throw new Error(`agenda html not found: ${String(payload?.local_agenda_html || payload?.local_transcript_html || "")}`);
  }
  assertPathWithin(payloadDir, htmlSourcePath, "agenda_html");
  const imageSourcePath = resolveMaybeRelative(payloadDir, payload?.local_cover_image);
  if (imageSourcePath) assertPathWithin(payloadDir, imageSourcePath, "cover_image");

  let html = fs.readFileSync(htmlSourcePath, "utf8");
  html = stripDisallowedTags(html);
  if (!hasTitleTag(html)) throw new Error("agenda_html missing <title>");
  if (!hasMetaDescription(html)) throw new Error("agenda_html missing meta description");

  const expectedCanonical = String(payload?.agenda_url || "").trim() || toAgendaUrl(siteUrl, jurisdiction, body, dateIso);
  const foundCanonical = extractCanonicalHref(html);
  if (!foundCanonical) throw new Error("agenda_html missing canonical link");
  if (foundCanonical !== expectedCanonical) {
    throw new Error(`canonical mismatch: found=${foundCanonical} expected=${expectedCanonical}`);
  }

  const attachmentIndexPath = resolveMaybeRelative(payloadDir, payload?.local_attachment_index);
  const sourceAttachments = Array.isArray(payload?.local_source_attachments) ? payload.local_source_attachments : [];
  const attachmentPlan = buildSupportingAttachmentMirrorPlan({ payloadDir, attachmentIndexPath, sourceAttachments });
  process.stdout.write(`[agenda-publish] supporting attachments: ${attachmentPlan.length}\n`);
  if (!dryRun && attachmentPlan.length) {
    if (!token) throw new Error("AGENDA_PUBLISH_AUTH_TOKEN (or MEETING_PUBLISH_AUTH_TOKEN) is required to mirror attachments");
    const attachmentEndpoint = String(
      process.env.ATTACHMENT_PUBLISH_ENDPOINT
      || envFallback.ATTACHMENT_PUBLISH_ENDPOINT
      || DEFAULT_ATTACHMENT_ENDPOINT
    ).trim();
    const responseBase = path.basename(payloadPath, path.extname(payloadPath));
    const mirrored = await mirrorSupportingAttachments({
      payloadDir,
      attachmentIndexPath,
      sourceAttachments,
      endpoint: attachmentEndpoint,
      token,
      jurisdiction,
      body,
      dateIso,
      responsePath: path.join(payloadDir, `${responseBase}.supporting-attachments.mirror.response.json`),
      log: (message) => process.stdout.write(`${message}\n`),
    });
    postBody = rewriteSupportingAttachmentUrls(postBody, mirrored.mapping);
    html = rewriteSupportingAttachmentUrls(html, mirrored.mapping);
    const survivors = attachmentPlan
      .map((entry) => entry.sourceUrl)
      .filter((sourceUrl) => postBody.includes(sourceUrl) || html.includes(sourceUrl));
    if (survivors.length) {
      throw new Error(`official supporting attachment URLs survived mirror rewrite: ${survivors.join(", ")}`);
    }
  }

  const idempotencyKey = buildIdempotencyKey({
    jurisdiction,
    body,
    dateIso,
    postTitle,
    postBody,
    explicit: process.env.AGENDA_PUBLISH_IDEMPOTENCY_KEY || envFallback.AGENDA_PUBLISH_IDEMPOTENCY_KEY || idempotencyArg,
  });

  const uploadHtmlPath = path.join(payloadDir, `${path.basename(htmlSourcePath, path.extname(htmlSourcePath))}.agenda-publish.html`);
  fs.writeFileSync(uploadHtmlPath, html, "utf8");

  const metadataBase = {
    jurisdiction: slugify(jurisdiction),
    body: slugify(body),
    date_iso: dateIso,
    post_title: postTitle,
    post_body: postBody,
  };
  if (suffix) metadataBase.suffix = suffix;
  if (communityName) metadataBase.community_name = communityName;
  if (parsedRef.post_id) metadataBase.post_id = parsedRef.post_id;
  if (parsedRef.post_url) metadataBase.post_url = parsedRef.post_url;
  if (publishUsername) metadataBase.publish_username = publishUsername;
  if (publishPassword) metadataBase.publish_password = publishPassword;
  if (transcriptUrl) metadataBase.transcript_url = transcriptUrl;
  if (officialSourceUrl) metadataBase.source_url = officialSourceUrl;

  const extras = parseExtras(process.env.AGENDA_PUBLISH_EXTRAS_JSON || envFallback.AGENDA_PUBLISH_EXTRAS_JSON || extrasArg);

  process.stdout.write(`[agenda-publish] mode: ${updateMode ? "UPDATE" : "CREATE"}\n`);
  process.stdout.write(`[agenda-publish] endpoint: ${endpoint}\n`);
  process.stdout.write(`[agenda-publish] agenda_html: ${uploadHtmlPath}\n`);
  process.stdout.write(`[agenda-publish] idempotency_key: ${idempotencyKey}\n`);
  process.stdout.write(`[agenda-publish] publish_username: ${publishUsername ? publishUsername : "(none)"}\n`);
  process.stdout.write(`[agenda-publish] publish_password: ${publishPassword ? "(set)" : "(none)"}\n`);
  if (imageSourcePath && fs.existsSync(imageSourcePath)) {
    process.stdout.write(`[agenda-publish] cover_image: ${imageSourcePath}\n`);
  }

  if (dryRun) {
    process.stdout.write("[agenda-publish] dry-run enabled, request not sent.\n");
    process.exit(0);
  }
  if (!token) throw new Error("AGENDA_PUBLISH_AUTH_TOKEN (or MEETING_PUBLISH_AUTH_TOKEN) is required unless dry-run");

  const maxAttempts = Math.max(
    1,
    Number.parseInt(String(process.env.AGENDA_PUBLISH_MAX_ATTEMPTS || envFallback.AGENDA_PUBLISH_MAX_ATTEMPTS || "6"), 10) || 6
  );
  const baseRetryDelayMs = Math.max(
    1000,
    Number.parseInt(String(process.env.AGENDA_PUBLISH_RETRY_DELAY_MS || envFallback.AGENDA_PUBLISH_RETRY_DELAY_MS || "12000"), 10) || 12000
  );
  const retryJitterMs = Math.max(
    0,
    Number.parseInt(String(process.env.AGENDA_PUBLISH_RETRY_JITTER_MS || envFallback.AGENDA_PUBLISH_RETRY_JITTER_MS || "4000"), 10) || 4000
  );

  let disableCoverUpload = false;

  function buildMultipartForm(metadata) {
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append("agenda_html", new Blob([html], { type: "text/html; charset=utf-8" }), path.basename(uploadHtmlPath));
    if (!disableCoverUpload && imageSourcePath && fs.existsSync(imageSourcePath)) {
      const imageBuf = fs.readFileSync(imageSourcePath);
      const ext = path.extname(imageSourcePath).toLowerCase();
      const contentType = ext === ".png" ? "image/png" : (ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream");
      form.append("cover_image", new Blob([imageBuf], { type: contentType }), path.basename(imageSourcePath));
    }
    if (extras) form.append("extras_json", JSON.stringify(extras));
    return form;
  }

  const responseBase = path.basename(payloadPath, path.extname(payloadPath));
  const responsePath = path.join(payloadDir, `${responseBase}.agenda-publish.response.json`);

  let res = null;
  let raw = "";
  let parsed = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const meta = { ...metadataBase, idempotency_key: withAttemptSuffix(idempotencyKey, attempt) };
    process.stdout.write(`[agenda-publish] attempt ${attempt}/${maxAttempts} key=${meta.idempotency_key}\n`);
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: buildMultipartForm(meta),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    raw = await res.text();
    parsed = null;
    try { parsed = JSON.parse(raw); } catch {}

    const attemptPath = path.join(payloadDir, `${responseBase}.agenda-publish.response.attempt-${String(attempt).padStart(2, "0")}.json`);
    fs.writeFileSync(attemptPath, `${parsed ? JSON.stringify(parsed, null, 2) : raw}\n`, "utf8");
    process.stdout.write(`[agenda-publish] attempt response saved: ${attemptPath}\n`);

    if (res.ok) break;

    const pictrsUploadFailure = String(parsed?.error || "").toLowerCase().includes("failed to upload cover image to pictrs");
    if (pictrsUploadFailure && !disableCoverUpload && imageSourcePath && fs.existsSync(imageSourcePath)) {
      disableCoverUpload = true;
      process.stdout.write("[agenda-publish] cover upload failed; retrying without cover image\n");
      continue;
    }

    const rateLimited = isRateLimited(res.status, parsed);
    const transientServerFailure = Number(res.status) >= 500;
    const retryable = rateLimited || transientServerFailure;
    if (!retryable || attempt >= maxAttempts) break;

    const jitterMs = retryJitterMs > 0 ? Math.floor(Math.random() * (retryJitterMs + 1)) : 0;
    let waitMs = baseRetryDelayMs + jitterMs;
    if (rateLimited) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      waitMs = Math.max(waitMs, retryAfterMs);
      process.stdout.write(`[agenda-publish] rate limited, waiting ${waitMs}ms before retry\n`);
    } else {
      const serverBackoff = Math.min(120000, baseRetryDelayMs * attempt);
      waitMs = serverBackoff + jitterMs;
      process.stdout.write(`[agenda-publish] transient server error (${res.status}), waiting ${waitMs}ms before retry\n`);
    }
    await sleep(waitMs);
  }

  fs.writeFileSync(responsePath, `${parsed ? JSON.stringify(parsed, null, 2) : raw}\n`, "utf8");
  process.stdout.write(`[agenda-publish] response saved: ${responsePath}\n`);

  if (!res.ok) {
    throw new Error(`agenda-publish failed (${res.status}): ${raw.slice(0, 1200)}`);
  }
  if (parsed && typeof parsed === "object") {
    if (parsed.post_url) process.stdout.write(`[agenda-publish] post_url: ${parsed.post_url}\n`);
    if (parsed.agenda_url) process.stdout.write(`[agenda-publish] agenda_url: ${parsed.agenda_url}\n`);
    if (parsed.transcript_url) process.stdout.write(`[agenda-publish] transcript_url: ${parsed.transcript_url}\n`);
    if (typeof parsed.idempotent_replay === "boolean") process.stdout.write(`[agenda-publish] idempotent_replay: ${String(parsed.idempotent_replay)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
