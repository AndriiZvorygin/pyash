#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function usage() {
  return [
    'Usage: node command/municipal_reporter_runner.mjs <pipeline|publish> <request_json>',
  ].join('\n');
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function runNode({ scriptPath, args, env }) {
  const run = spawnSync('node', [scriptPath, ...args], {
    cwd: '/home/htaf/pyac/pyash',
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if ((run.status ?? 1) !== 0) fail(`runner failed: status=${run.status ?? 1}`);
}

function asAbs(p) {
  const raw = String(p || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.resolve('/home/htaf/pyac/pyash', raw);
}

function main() {
  const mode = String(process.argv[2] || '').trim();
  const requestPath = asAbs(process.argv[3]);
  if (!mode || !requestPath) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(requestPath)) fail(`request missing: ${requestPath}`);
  const req = JSON.parse(fs.readFileSync(requestPath, 'utf8'));

  if (mode === 'pipeline') {
    const houseRoot = asAbs(req.house_root);
    const transcriptDir = asAbs(req.transcript_dir);
    if (!houseRoot || !transcriptDir) fail('pipeline request requires house_root and transcript_dir');

    runNode({
      scriptPath: path.join(houseRoot, 'program/run-full-transcript-pipeline.mjs'),
      args: [
        transcriptDir,
        String(req.base_prefix || 'meeting-qwen-auto'),
        String(req.focus || 'the newsworthy juicy and unusual bits'),
        String(req.jurisdiction || 'Owen Sound'),
        String(req.body || 'Council'),
        String(req.site_url || 'https://helpos.ca'),
        String(req.discussion_url || ''),
      ],
      env: {
        PYA_COMMAND_TIMEOUT_MS: String(req.timeout_ms || 28800000),
        OWEN_PIPELINE_SKIP_IMAGE: String(req.skip_image || '0'),
        OWEN_PIPELINE_SKIP_LEMMY: String(req.skip_lemmy || '0'),
      },
    });
    return;
  }

  if (mode === 'publish') {
    const houseRoot = asAbs(req.house_root);
    const payloadJson = asAbs(req.payload_json);
    if (!houseRoot || !payloadJson) fail('publish request requires house_root and payload_json');

    runNode({
      scriptPath: path.join(houseRoot, 'program/publish-meeting-to-helpos-from-payload.mjs'),
      args: [
        payloadJson,
        String(req.community_name || ''),
        String(req.idempotency_key || ''),
        String(req.post_ref || ''),
        String(req.extras_json || ''),
        String(req.dry_run || '1'),
      ],
      env: {},
    });
    return;
  }

  fail(`unknown mode: ${mode}`);
}

main();
