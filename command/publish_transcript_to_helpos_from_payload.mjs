#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readPyaTextValues } from './pya_lookup.mjs';
import {
  buildSourceProvenance,
  extractAgendaTimestampBoundaries,
  refineBoundariesWithMinutes,
  runTranscriptPublishGate,
} from '../program/library/reporter_shared/transcript_reliability.mjs';

const DEFAULT_ENDPOINT = 'https://helpos.ca/api/helpos/v1/transcript-publish';

function usage() {
  return 'Usage: node command/publish_transcript_to_helpos_from_payload.mjs <lemmy_payload_json> [community_name] [idempotency_key] [post_ref] [extras_json] [dry_run]';
}

function parseDotEnvText(src) {
  const out = {};
  for (const rawLine of String(src || '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function readEnvFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseDotEnvText(fs.readFileSync(filePath, 'utf8'));
}

function loadEnvFallbacks(cwdDir) {
  const merged = {};
  let cur = path.resolve(cwdDir);
  while (true) {
    Object.assign(merged, readEnvFileIfExists(path.join(cur, '.env')));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return merged;
}

function readSecretValues(cwdDir) {
  const candidates = [
    path.join(cwdDir, 'configure/secret.pya'),
    path.join(path.resolve(cwdDir, '..'), 'configure/secret.pya'),
    path.join(path.resolve(cwdDir, '../..'), 'configure/secret.pya'),
  ];
  const secretPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  return readPyaTextValues(secretPath, [
    'meeting publish auth token',
    'meeting publish community name',
    'meeting publish site url',
  ]);
}

function resolveMaybeRelative(baseDir, rawPath) {
  const p = String(rawPath || '').trim();
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}

function parsePostRef(postRefRaw) {
  const postRef = String(postRefRaw || '').trim();
  if (!postRef) return { post_id: '', post_url: '' };
  if (/^\d+$/u.test(postRef)) return { post_id: String(Number(postRef)), post_url: '' };
  if (/^https?:\/\//iu.test(postRef)) return { post_id: '', post_url: postRef };
  return { post_id: '', post_url: '' };
}

function buildIdempotencyKey({ explicit, payload }) {
  const ex = String(explicit || '').trim();
  if (ex) return ex;
  return `transcript-${String(payload?.jurisdiction || 'unknown')}-${String(payload?.body || 'unknown')}-${String(payload?.date_iso || 'unknown')}-${crypto.createHash('sha256').update(String(payload?.title || ''), 'utf8').digest('hex').slice(0, 8)}`;
}

async function main() {
  const payloadArg = process.argv[2];
  const communityArg = process.argv[3] || '';
  const idempotencyArg = process.argv[4] || '';
  const postRefArg = process.argv[5] || '';
  const dryRunArg = process.argv[7] || '';
  if (!payloadArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const envFallback = loadEnvFallbacks(process.cwd());
  const secret = readSecretValues(process.cwd());
  const endpoint = String(process.env.TRANSCRIPT_PUBLISH_ENDPOINT || DEFAULT_ENDPOINT).trim();
  const token = String(process.env.MEETING_PUBLISH_AUTH_TOKEN || envFallback.MEETING_PUBLISH_AUTH_TOKEN || secret['meeting publish auth token'] || '').trim();
  const dryRun = /^(1|true|yes)$/iu.test(String(process.env.TRANSCRIPT_PUBLISH_DRY_RUN || dryRunArg || '0'));

  const payloadPath = path.resolve(process.cwd(), payloadArg);
  const payloadDir = path.dirname(payloadPath);
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  const meetingDir = path.resolve(payloadDir, '..');
  const transcriptDir = payloadDir;
  const prefix = path.basename(payloadPath).replace(/\.lemmy-post\.json$/u, '');

  const provenance = buildSourceProvenance({ meetingDir, transcriptDir, prefix, payload });
  const timestamps = extractAgendaTimestampBoundaries({ meetingDir, transcriptDir, prefix, transcriptDurationSeconds: Number(payload?.source?.duration_seconds || 0) });
  const refine = refineBoundariesWithMinutes({ meetingDir, transcriptDir, prefix });

  const gate = runTranscriptPublishGate({ payloadPath, payload, provenancePath: provenance.artifactPath, timestampPath: timestamps.artifactPath, refinePath: refine.artifactPath });
  if (!gate.pass) {
    throw new Error(`transcript publish gate blocked: ${gate.blockedReasons.join(', ')} | report=${gate.gatePath}`);
  }

  const htmlSourcePath = resolveMaybeRelative(payloadDir, payload?.local_transcript_html);
  if (!htmlSourcePath || !fs.existsSync(htmlSourcePath)) throw new Error(`transcript html not found: ${String(payload?.local_transcript_html || '')}`);

  const communityName = String(process.env.MEETING_PUBLISH_COMMUNITY_NAME || envFallback.MEETING_PUBLISH_COMMUNITY_NAME || secret['meeting publish community name'] || communityArg || payload?.community_name || '').trim();
  const siteUrl = String(process.env.MEETING_PUBLISH_SITE_URL || envFallback.MEETING_PUBLISH_SITE_URL || secret['meeting publish site url'] || 'https://helpos.ca').trim();

  const parsedRef = parsePostRef(String(process.env.MEETING_PUBLISH_POST_REF || envFallback.MEETING_PUBLISH_POST_REF || '') || postRefArg || payload?.post_id || payload?.post_url || '');
  const updateMode = Boolean(parsedRef.post_id || parsedRef.post_url);
  if (!updateMode && !communityName) throw new Error('CREATE mode requires community_name');

  const metadata = {
    idempotency_key: buildIdempotencyKey({ explicit: process.env.MEETING_PUBLISH_IDEMPOTENCY_KEY || envFallback.MEETING_PUBLISH_IDEMPOTENCY_KEY || idempotencyArg, payload }),
    jurisdiction: String(payload?.jurisdiction || '').trim(),
    body: String(payload?.body || '').trim(),
    meeting_date: String(payload?.date_iso || '').trim(),
    post_title: String(payload?.title || '').trim(),
    post_body: String(payload?.body_markdown || '').trim(),
    community_name: updateMode ? undefined : communityName,
    site_url: siteUrl,
    post_id: parsedRef.post_id || undefined,
    post_url: parsedRef.post_url || undefined,
    dry_run: dryRun,
  };

  process.stdout.write(`[transcript-publish] mode: ${updateMode ? 'UPDATE' : 'CREATE'}\n`);
  process.stdout.write(`[transcript-publish] endpoint: ${endpoint}\n`);

  if (dryRun) {
    process.stdout.write('[transcript-publish] dry-run enabled, request not sent.\n');
    return;
  }
  if (!token) throw new Error('MEETING_PUBLISH_AUTH_TOKEN is required');

  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set('transcript_html', new Blob([fs.readFileSync(htmlSourcePath)], { type: 'text/html' }), path.basename(htmlSourcePath));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}

  const responsePath = path.join(payloadDir, `${prefix}.lemmy-post.transcript-publish.response.json`);
  fs.writeFileSync(responsePath, `${JSON.stringify({ status: res.status, ok: res.ok, parsed, raw }, null, 2)}\n`, 'utf8');
  process.stdout.write(`[transcript-publish] response saved: ${responsePath}\n`);
  if (!res.ok) throw new Error(`transcript-publish failed (${res.status}): ${raw.slice(0, 1200)}`);
  if (parsed?.post_url) process.stdout.write(`[transcript-publish] post_url: ${parsed.post_url}\n`);
  if (parsed?.transcript_url) process.stdout.write(`[transcript-publish] transcript_url: ${parsed.transcript_url}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
