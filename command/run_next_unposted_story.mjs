#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULTS = {
  timezone: process.env.TZ || 'America/Toronto',
  base_prefix: 'meeting-qwen-auto',
  focus: 'the newsworthy juicy and unusual bits',
  jurisdiction: 'auto',
  body: 'auto',
  site_url: 'https://helpos.ca',
  discussion_url: '',
  exec_mxid: '',
  community_name: '',
  transcript_archive_url: '',
  transcript_jurisdiction_slug: '',
};

function parseDotEnvText(src) {
  const out = {};
  const lines = String(src || '').split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFileIfExists(filePath) {
  if (!filePath) return {};
  if (!fs.existsSync(filePath)) return {};
  return parseDotEnvText(fs.readFileSync(filePath, 'utf8'));
}

function loadEnvFallbacks(startDir) {
  const start = path.resolve(startDir);
  const dirs = [];
  let cur = start;
  while (true) {
    dirs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const merged = {};
  for (const dir of dirs.reverse()) {
    Object.assign(merged, readEnvFileIfExists(path.join(dir, '.env')));
  }
  return merged;
}

function usage() {
  return [
    'Usage: node command/run_next_unposted_story.mjs <config.json>',
    'Config keys:',
    '  house_root, monthly_dir, meetings_dir',
    '  refresh_calendar_cmd: ["node", ".../extract-...mjs"]',
    '  run_meeting_from_ref_cmd: ["node", ".../run-...-meeting-from-ref.mjs"]',
    '  send_dm_cmd: ["node", ".../send-executive-dm.mjs"] (optional)',
    '  transcript_archive_url / transcript_jurisdiction_slug (optional remote posted check)',
    '  plus optional defaults: base_prefix, focus, jurisdiction, body, site_url, discussion_url, exec_mxid, community_name, timezone',
  ].join('\n');
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseSeriesLine(line) {
  const m = line.match(/^su name (.+?) since date (\S+) until date (\S+) ob text "(.+)" ya$/u);
  if (!m) return null;
  const [, suName, since, until, escapedJson] = m;
  try {
    const jsonText = JSON.parse(`"${escapedJson}"`);
    const payload = JSON.parse(jsonText);
    return { suName, since, until, payload };
  } catch {
    return null;
  }
}

function parseLocalDate(isoLike) {
  const s = String(isoLike || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(s)) return null;
  const [date, time] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss, 0);
}

function nowLocalDate(timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type, fallback) => parts.find((p) => p.type === type)?.value || fallback;
  return new Date(
    Number(get('year', '1970')),
    Number(get('month', '01')) - 1,
    Number(get('day', '01')),
    Number(get('hour', '00')),
    Number(get('minute', '00')),
    Number(get('second', '00')),
    0,
  );
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'meeting';
}

function inferPrimaryBodySlugFromPayload(payload = {}) {
  const meetingName = String(payload?.meeting_name || '').toLowerCase();
  const meetingType = String(payload?.meeting_type || '').toLowerCase();
  const source = `${meetingName} ${meetingType}`.trim();
  if (!source) return '';
  if (/committee of the whole/.test(source)) return 'committee-of-the-whole';
  if (/county council/.test(source)) return 'county-council';
  if (/committee\s*-\s*community services|community services/.test(source)) return 'committee-community-services';
  if (/committee\s*-\s*operations|operations/.test(source)) return 'committee-operations';
  if (/committee\s*-\s*corporate services|corporate services/.test(source)) return 'committee-corporate-services';
  if (/task force/.test(source)) return 'task-force';
  if (/committee/.test(source)) return 'committee';
  if (/council/.test(source)) return 'council';
  return '';
}

function inferBodySlugCandidatesFromPayload(payload = {}, bodyDefault = '') {
  const out = [];
  const add = (s) => {
    if (!s) return;
    const slug = slugify(s);
    if (!out.includes(slug)) out.push(slug);
  };
  const inferred = inferPrimaryBodySlugFromPayload(payload);
  if (inferred) add(inferred);
  if (bodyDefault && bodyDefault !== 'auto') add(bodyDefault);
  // Conservative fallback only when no reliable hint exists.
  if (!out.length) {
    add('county-council');
    add('committee-of-the-whole');
    add('council');
    add('committee');
  }
  return out;
}

function inferFolder(row) {
  const payload = row.payload || {};
  const day = String(row.since || '').slice(0, 10) || 'unknown-day';
  const id = String(payload.meeting_id || 'unknown-id');
  return `${day}_${slugify(payload.meeting_name)}_${id.slice(0, 8)}`;
}

function findPublishResponsePath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return '';
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.meeting-publish.response.json`);
  const files = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => n.endsWith('.meeting-publish.response.json'))
    .sort();
  if (fs.existsSync(direct) && files.includes(path.basename(direct))) {
    return direct;
  }
  if (fs.existsSync(direct)) return direct;
  if (!files.length) return '';
  return path.join(transcriptDir, files[files.length - 1]);
}

function parsePostedFromResponse(respPath) {
  if (!respPath || !fs.existsSync(respPath)) return { posted: false, post_url: '', transcript_url: '' };
  try {
    const json = JSON.parse(fs.readFileSync(respPath, 'utf8'));
    const postUrl = String(json?.post_url || '').trim();
    const transcriptUrl = String(json?.transcript_url || '').trim();
    const err = String(json?.error || '').trim();
    return {
      posted: Boolean((postUrl || transcriptUrl) && !err),
      post_url: postUrl,
      transcript_url: transcriptUrl,
    };
  } catch {
    return { posted: false, post_url: '', transcript_url: '' };
  }
}

function listPublishResponsePaths(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return [];
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.meeting-publish.response.json`);
  const others = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => n.endsWith('.meeting-publish.response.json'))
    .map((n) => path.join(transcriptDir, n))
    .sort();

  const unique = [];
  const seen = new Set();
  const push = (p) => {
    const key = path.resolve(p);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(p);
  };
  if (fs.existsSync(direct)) push(direct);
  for (const p of others) push(p);
  return unique;
}

function parsePostedFromResponses(transcriptDir, basePrefix) {
  const paths = listPublishResponsePaths(transcriptDir, basePrefix);
  let last = { posted: false, post_url: '', transcript_url: '' };
  let lastPath = '';
  for (const p of paths) {
    const parsed = parsePostedFromResponse(p);
    if (parsed.posted) return { ...parsed, response_path: p };
    last = parsed;
    lastPath = p;
  }
  return { ...last, response_path: lastPath };
}

function loadAllMeetings(monthlyDir) {
  if (!fs.existsSync(monthlyDir)) return [];
  const files = fs.readdirSync(monthlyDir)
    .filter((n) => n.endsWith('.events.series.pya'))
    .map((n) => path.join(monthlyDir, n))
    .sort();

  const rows = [];
  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line === 'prah' || line.startsWith('su name ')) {
        if (!line.includes(' since date ')) continue;
      }
      const row = parseSeriesLine(line);
      if (!row) continue;
      rows.push(row);
    }
  }
  return rows;
}

function meetingState(row, meetingsDir, basePrefix) {
  const folder = inferFolder(row);
  const meetingDir = path.join(meetingsDir, folder);
  const transcriptDir = path.join(meetingDir, 'transcript');
  const payloadPath = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.json`);
  const responsePath = findPublishResponsePath(transcriptDir, basePrefix);
  const postedInfo = parsePostedFromResponses(transcriptDir, basePrefix);
  const payload = row.payload || {};
  const agendaCount = Array.isArray(payload.agenda) ? payload.agenda.length : 0;
  const agendaCoverCount = Array.isArray(payload.agenda_cover) ? payload.agenda_cover.length : 0;
  const minutesCount = Array.isArray(payload.minutes) ? payload.minutes.length : 0;
  // Typical eScribe upcoming meetings expose one agenda PDF plus one agenda HTML link.
  // Treat only *additional* agenda docs (beyond that pair) and minutes as supporting docs.
  const supportDocCount = Math.max(0, agendaCount - 2) + minutesCount;

  return {
    row,
    folder,
    meeting_dir: meetingDir,
    transcript_dir: transcriptDir,
    payload_path: payloadPath,
    response_path: postedInfo.response_path || responsePath,
    posted: postedInfo.posted,
    posted_local: postedInfo.posted,
    posted_remote: false,
    post_url: postedInfo.post_url,
    transcript_url: postedInfo.transcript_url,
    has_agenda: agendaCount > 0,
    has_video: Array.isArray(payload.video) && payload.video.length > 0,
    agenda_count: agendaCount,
    agenda_cover_count: agendaCoverCount,
    minutes_count: minutesCount,
    support_doc_count: supportDocCount,
    has_supporting_docs: supportDocCount > 0,
    since_date: parseLocalDate(row.since),
  };
}

function eligibleUpcomingAgendaStates(states, timezone, cfg = {}) {
  const now = nowLocalDate(timezone);
  const notPosted = states.filter((s) => !s.posted && s.since_date instanceof Date);
  const requireSupportingDocs = /^(1|true|yes)$/iu.test(String(cfg.require_upcoming_supporting_docs || "0"));
  return notPosted
    .filter((s) => {
      if (s.since_date < now) return false;
      if (!s.has_agenda) return false;
      if (requireSupportingDocs && !s.has_supporting_docs) return false;
      return true;
    })
    .sort((a, b) => a.since_date - b.since_date);
}

function pickCandidate(states, timezone, cfg = {}) {
  const now = nowLocalDate(timezone);
  const notPosted = states.filter((s) => !s.posted && s.since_date instanceof Date);

  const upcomingWithAgenda = eligibleUpcomingAgendaStates(states, timezone, cfg);
  if (upcomingWithAgenda.length) return { mode: 'upcoming_agenda', state: upcomingWithAgenda[0] };

  const pastWithVideo = notPosted
    .filter((s) => s.has_video && s.since_date < now)
    .sort((a, b) => b.since_date - a.since_date);
  if (pastWithVideo.length) return { mode: 'past_video', state: pastWithVideo[0] };

  return null;
}

async function urlExists(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (head.status >= 200 && head.status < 300) return true;
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
      return get.status >= 200 && get.status < 300;
    }
    return false;
  } catch {
    return false;
  }
}

async function isPostedByDirectTranscriptProbe(state, cfg, cache) {
  const site = String(cfg.site_url || '').replace(/\/+$/u, '');
  if (!site) return false;
  const jurisdictionSlug = slugify(cfg.transcript_jurisdiction_slug || cfg.jurisdiction || '');
  const dateIso = parseDateIsoFromSince(state?.row?.since);
  if (!jurisdictionSlug || !dateIso) return false;

  const payload = state?.row?.payload || {};
  const bodySlugs = inferBodySlugCandidatesFromPayload(payload, cfg.body);
  for (const bodySlug of bodySlugs) {
    const url = `${site}/transcripts/${jurisdictionSlug}/${bodySlug}/${dateIso}`;
    if (cache.has(url)) {
      if (cache.get(url)) return true;
      continue;
    }
    const ok = await urlExists(url);
    cache.set(url, ok);
    if (ok) return true;
  }
  return false;
}

async function pickCandidateWithRemoteProbe(states, timezone, cfg) {
  const picked = pickCandidate(states, timezone, cfg);
  if (!picked) return null;

  const now = nowLocalDate(timezone);
  const notPosted = states.filter((s) => !s.posted && s.since_date instanceof Date);
  const upcomingWithAgenda = eligibleUpcomingAgendaStates(states, timezone, cfg)
    .map((s) => ({ mode: 'upcoming_agenda', state: s }));
  const pastWithVideo = notPosted
    .filter((s) => s.has_video && s.since_date < now)
    .sort((a, b) => b.since_date - a.since_date)
    .map((s) => ({ mode: 'past_video', state: s }));
  const ordered = [...upcomingWithAgenda, ...pastWithVideo];
  const cache = new Map();

  for (const candidate of ordered) {
    const directPosted = await isPostedByDirectTranscriptProbe(candidate.state, cfg, cache);
    if (directPosted) continue;
    return candidate;
  }
  return null;
}

function parseDateIsoFromSince(since) {
  return String(since || '').slice(0, 10);
}

function extractTranscriptBodyDateKeysFromArchiveHtml(html, jurisdictionSlug) {
  const slug = String(jurisdictionSlug || '').trim().toLowerCase();
  const src = String(html || '');
  const out = new Set();
  const re = /\/transcripts\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})/giu;
  let m;
  while ((m = re.exec(src)) !== null) {
    const j = String(m[1] || '').toLowerCase();
    const body = String(m[2] || '').toLowerCase();
    const d = String(m[3] || '');
    if (!body || !d) continue;
    if (slug && j !== slug) continue;
    out.add(`${body}|${d}`);
  }
  return out;
}

async function fetchRemotePostedKeys(cfg) {
  const archiveUrl = String(cfg.transcript_archive_url || '').trim();
  if (!archiveUrl) return new Set();
  try {
    const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return new Set();
    const html = await res.text();
    return extractTranscriptBodyDateKeysFromArchiveHtml(html, cfg.transcript_jurisdiction_slug);
  } catch {
    return new Set();
  }
}

function mergeRemotePosted(states, remotePostedKeys, cfg = {}) {
  if (!remotePostedKeys || remotePostedKeys.size === 0) return states;
  return states.map((s) => {
    const iso = parseDateIsoFromSince(s?.row?.since);
    const payload = s?.row?.payload || {};
    const bodySlugs = inferBodySlugCandidatesFromPayload(payload, cfg.body);
    const remotePosted = Boolean(
      iso && bodySlugs.some((bodySlug) => remotePostedKeys.has(`${bodySlug}|${iso}`))
    );
    if (!remotePosted) return s;
    return {
      ...s,
      posted_remote: true,
      posted: true,
    };
  });
}

function runWithStreaming({ cmd, args, cwd, env = {}, timeoutMs = 60 * 60 * 1000, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const t = String(chunk || '');
      stdout += t;
      process.stdout.write(t);
    });
    child.stderr.on('data', (chunk) => {
      const t = String(chunk || '');
      stderr += t;
      process.stderr.write(t);
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(10_000, Number(timeoutMs) || 10_000));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? 'null'} signal=${signal ?? ''})\n${stderr || stdout}`.trim()));
    });
  });
}

async function maybeNotify(cfg, execMxid, message) {
  const dm = Array.isArray(cfg.send_dm_cmd) ? cfg.send_dm_cmd : [];
  if (!dm.length) return;
  try {
    await runWithStreaming({
      cmd: dm[0],
      args: [...dm.slice(1), execMxid, message],
      cwd: cfg.house_root,
      timeoutMs: 2 * 60 * 1000,
      label: 'notify-dm',
    });
  } catch (err) {
    process.stderr.write(`[next-story] dm notification failed: ${String(err?.message || err)}\n`);
  }
}

function ensureString(value, name) {
  const v = String(value || '').trim();
  if (!v) throw new Error(`config missing required string: ${name}`);
  return v;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const cfgRaw = readJson(path.resolve(process.cwd(), configPath));
  const cfg = { ...DEFAULTS, ...cfgRaw };
  const envFallback = loadEnvFallbacks(process.cwd());

  cfg.house_root = ensureString(cfg.house_root, 'house_root');
  cfg.monthly_dir = ensureString(cfg.monthly_dir, 'monthly_dir');
  cfg.meetings_dir = ensureString(cfg.meetings_dir, 'meetings_dir');
  if (!Array.isArray(cfg.refresh_calendar_cmd) || !cfg.refresh_calendar_cmd.length) {
    throw new Error('config missing refresh_calendar_cmd array');
  }
  if (!Array.isArray(cfg.run_meeting_from_ref_cmd) || !cfg.run_meeting_from_ref_cmd.length) {
    throw new Error('config missing run_meeting_from_ref_cmd array');
  }

  const pickOnly = /^(1|true|yes)$/iu.test(String(process.env.NEXT_STORY_PICK_ONLY || process.env.OWEN_NEXT_STORY_PICK_ONLY || '0'));
  const skipRefresh = /^(1|true|yes)$/iu.test(String(process.env.NEXT_STORY_SKIP_REFRESH || process.env.OWEN_SKIP_MONTHLY_REFRESH || '0'));

  if (!process.env.MEETING_PUBLISH_AUTH_TOKEN) {
    const token = String(envFallback.MEETING_PUBLISH_AUTH_TOKEN || '').trim();
    if (token) process.env.MEETING_PUBLISH_AUTH_TOKEN = token;
  }
  if (!process.env.MEETING_PUBLISH_COMMUNITY_NAME) {
    const communityName = String(envFallback.MEETING_PUBLISH_COMMUNITY_NAME || cfg.community_name || '').trim();
    if (communityName) process.env.MEETING_PUBLISH_COMMUNITY_NAME = communityName;
  }

  if (skipRefresh) {
    log('[next-story] skip calendar refresh (NEXT_STORY_SKIP_REFRESH=1)');
  } else {
    log('[next-story] refreshing calendar cache');
    await runWithStreaming({
      cmd: cfg.refresh_calendar_cmd[0],
      args: cfg.refresh_calendar_cmd.slice(1),
      cwd: cfg.house_root,
      timeoutMs: 5 * 60 * 1000,
      label: 'refresh-calendar',
    });
  }

  const rows = loadAllMeetings(cfg.monthly_dir);
  if (!rows.length) throw new Error('no meetings in monthly cache');

  const localStates = rows.map((row) => meetingState(row, cfg.meetings_dir, cfg.base_prefix));
  const remotePostedKeys = await fetchRemotePostedKeys(cfg);
  if (remotePostedKeys.size > 0) {
    log(`[next-story] remote transcript body/date keys found: ${remotePostedKeys.size}`);
  }
  const states = mergeRemotePosted(localStates, remotePostedKeys, cfg);
  const picked = await pickCandidateWithRemoteProbe(states, cfg.timezone, cfg);
  const execMxid = cfg.exec_mxid;

  if (!picked) {
    log('[next-story] no unposted candidate found');
    await maybeNotify(cfg, execMxid, '[reporter] No unposted meeting candidate found (upcoming agenda or past video).');
    return;
  }

  const { mode, state } = picked;
  const payload = state.row.payload || {};
  const meetingRef = String(payload.meeting_id || payload.meeting_url || '').trim();
  if (!meetingRef) throw new Error('picked meeting has no meeting_id or meeting_url');

  log(`[next-story] picked mode: ${mode}`);
  log(`[next-story] meeting: ${payload.meeting_name || '(unknown)'} (${state.row.since})`);
  log(`[next-story] ref: ${meetingRef}`);

  if (pickOnly) {
    const pickPath = path.join(state.meeting_dir, 'next-story.pick.json');
    fs.mkdirSync(state.meeting_dir, { recursive: true });
    fs.writeFileSync(pickPath, `${JSON.stringify({
      mode,
      meeting_id: String(payload.meeting_id || ''),
      meeting_name: String(payload.meeting_name || ''),
      since: state.row.since,
      meeting_url: String(payload.meeting_url || ''),
      meeting_dir: state.meeting_dir,
      generated_at_utc: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    log(`[next-story] pick-only mode, wrote: ${pickPath}`);
    return;
  }

  if (!String(process.env.MEETING_PUBLISH_AUTH_TOKEN || '').trim()) {
    throw new Error('MEETING_PUBLISH_AUTH_TOKEN is missing (.env or env var) for non-pick runs');
  }

  const env = {
    ...process.env,
    PYA_COMMAND_TIMEOUT_MS: process.env.PYA_COMMAND_TIMEOUT_MS || '28800000',
    OWEN_PIPELINE_SKIP_IMAGE: process.env.OWEN_PIPELINE_SKIP_IMAGE || process.env.PIPELINE_SKIP_IMAGE || '0',
    OWEN_PIPELINE_SKIP_LEMMY: process.env.OWEN_PIPELINE_SKIP_LEMMY || process.env.PIPELINE_SKIP_POST || '0',
    OWEN_PIPELINE_FORCE: process.env.OWEN_PIPELINE_FORCE || process.env.PIPELINE_FORCE || '0',
    MEETING_PUBLISH_COMMUNITY_NAME: process.env.MEETING_PUBLISH_COMMUNITY_NAME || cfg.community_name || '',
  };

  const postCmd = String(
    process.env.MEETING_POST_COMMAND
    || process.env.OWEN_LEMMY_POST_COMMAND
    || ''
  ).trim();
  if (postCmd) {
    env.OWEN_LEMMY_POST_COMMAND = postCmd;
  } else {
    env.OWEN_LEMMY_POST_COMMAND = `node ${path.join(cfg.house_root, 'program/publish-meeting-to-helpos-from-payload.mjs')}`;
  }

  await runWithStreaming({
    cmd: cfg.run_meeting_from_ref_cmd[0],
    args: [
      ...cfg.run_meeting_from_ref_cmd.slice(1),
      meetingRef,
      cfg.base_prefix,
      cfg.focus,
      cfg.jurisdiction,
      cfg.body,
      cfg.site_url,
      cfg.discussion_url,
    ],
    cwd: cfg.house_root,
    env,
    timeoutMs: 8 * 60 * 60 * 1000,
    label: 'run-meeting',
  });

  const responsePath = findPublishResponsePath(state.transcript_dir, cfg.base_prefix);
  const postedInfo = parsePostedFromResponses(state.transcript_dir, cfg.base_prefix);
  const summaryPath = path.join(state.meeting_dir, 'next-story.result.json');

  fs.writeFileSync(summaryPath, `${JSON.stringify({
    mode,
    meeting_id: String(payload.meeting_id || ''),
    meeting_name: String(payload.meeting_name || ''),
    since: state.row.since,
    meeting_url: String(payload.meeting_url || ''),
    meeting_dir: state.meeting_dir,
    transcript_dir: state.transcript_dir,
    payload_path: path.join(state.transcript_dir, `${cfg.base_prefix}-normalized.lemmy-post.json`),
    response_path: postedInfo.response_path || responsePath,
    post_url: postedInfo.post_url,
    transcript_url: postedInfo.transcript_url,
    posted: postedInfo.posted,
    generated_at_utc: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  const dmLines = [
    `[reporter] Posted: ${payload.meeting_name || '(unknown meeting)'}`,
    `Date: ${state.row.since}`,
    postedInfo.post_url ? `Post: ${postedInfo.post_url}` : 'Post: (not found in response)',
    postedInfo.transcript_url ? `Transcript: ${postedInfo.transcript_url}` : 'Transcript: (not found in response)',
    `Meeting dir: ${state.meeting_dir}`,
  ];
  if (!postedInfo.posted) dmLines.unshift('[reporter] Run finished but publish confirmation was not found.');

  await maybeNotify(cfg, execMxid, dmLines.join('\n'));
}

main().catch(async (err) => {
  const msg = String(err?.stack || err?.message || err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
