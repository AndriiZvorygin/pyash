#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readPyaTextValues } from './pya_lookup.mjs';
import { writePyaMap } from '../program/library/reporter_shared/transcript_reliability.mjs';

function usage() {
  return 'Usage: node command/transcript_publish_preflight.mjs <lemmy_payload_json>';
}

function getSecretToken(cwd) {
  const paths = [
    path.join(cwd, 'configure/secret.pya'),
    path.join(path.resolve(cwd, '..'), 'configure/secret.pya'),
    path.join(path.resolve(cwd, '../..'), 'configure/secret.pya'),
  ];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const vals = readPyaTextValues(p, ['meeting publish auth token']);
    const tok = String(vals['meeting publish auth token'] || '').trim();
    if (tok) return { token: tok, source: p };
  }
  return { token: '', source: '' };
}

function main() {
  const payloadArg = process.argv[2];
  if (!payloadArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }
  const payloadPath = path.resolve(process.cwd(), payloadArg);
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const payloadDir = path.dirname(payloadPath);
  const prefix = path.basename(payloadPath).replace(/\.lemmy-post\.json$/u, '');
  const transcriptHtml = path.resolve(payloadDir, String(payload?.local_transcript_html || ''));
  const endpoint = String(process.env.TRANSCRIPT_PUBLISH_ENDPOINT || 'https://helpos.ca/api/helpos/v1/transcript-publish');

  const token = String(process.env.MEETING_PUBLISH_AUTH_TOKEN || '').trim();
  const secret = token ? { token, source: 'env' } : getSecretToken(process.cwd());
  const freeMb = Math.floor(os.freemem() / 1024 / 1024);
  const checks = {
    payload_exists: fs.existsSync(payloadPath),
    transcript_html_exists: fs.existsSync(transcriptHtml),
    auth_configured: Boolean(secret.token),
    endpoint_configured: Boolean(endpoint),
    idempotency_derivable: Boolean(String(payload?.idempotency_key || `${payload?.jurisdiction || ''}-${payload?.body || ''}-${payload?.date_iso || ''}`).trim()),
    post_title_derivable: Boolean(String(payload?.title || '').trim()),
    disk_memory_mb_over_256: freeMb > 256,
  };
  const blocked = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const status = blocked.length ? 'blocked' : 'pass';
  const outPath = path.join(payloadDir, `${prefix}.transcript-preflight.pya`);
  writePyaMap(outPath, {
    schema_version: 'transcript_preflight_v1',
    status,
    checks,
    blocked,
    endpoint,
    auth_source: secret.source || '',
    pass: status === 'pass',
  });
  process.stdout.write(`[transcript-preflight] ${status}: ${outPath}\n`);
  if (status !== 'pass') process.exit(1);
}

main();
