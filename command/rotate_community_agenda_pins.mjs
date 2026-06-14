#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPyaTextValues } from "./pya_lookup.mjs";

function parseArgs(argv) {
  const out = {
    community: "",
    instance: "https://helpos.ca",
    dryRun: false,
    today: "",
  };
  const args = argv.slice(2);
  while (args.length) {
    const arg = args.shift();
    if (arg === "--community") out.community = String(args.shift() || "").trim();
    else if (arg === "--instance") out.instance = String(args.shift() || "").trim();
    else if (arg === "--today") out.today = String(args.shift() || "").trim();
    else if (arg === "--dry-run") out.dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.community) throw new Error("--community is required");
  if (out.today && !/^\d{4}-\d{2}-\d{2}$/u.test(out.today)) throw new Error("--today must be YYYY-MM-DD");
  return out;
}

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
  }
  return out;
}

function loadEnvFallbacks(cwd) {
  const dirs = [];
  let current = path.resolve(cwd);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return Object.assign({}, ...dirs.reverse().map((dir) => parseDotEnv(path.join(dir, ".env"))));
}

function readSecrets(cwd) {
  const names = [
    "meeting publish username",
    "meeting publish password",
    "owen sound reporter username",
    "owen sound reporter password",
    "grey county reporter username",
    "grey county reporter password",
  ];
  const candidates = [
    path.join(cwd, "configure/secret.pya"),
    path.join(cwd, "../../configure/secret.pya"),
    path.join(cwd, "../../../configure/secret.pya"),
    path.join(cwd, "../../../../configure/secret.pya"),
    path.join(cwd, "world/house/owen-sound-reporter/configure/secret.pya"),
    path.join(cwd, "world/house/grey-county-reporter/configure/secret.pya"),
  ].map((p) => path.resolve(p));
  const merged = {};
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const values = readPyaTextValues(filePath, names);
    for (const name of names) if (!merged[name] && values[name]) merged[name] = values[name];
  }
  return merged;
}

function torontoDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function agendaDateFromPost(post = {}) {
  const text = `${post.name || ""}\n${post.body || ""}`;
  if (!/\bagenda preview\b/iu.test(text)) return "";
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/u);
  if (iso) return iso[1];
  const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/iu);
  if (!named) return "";
  const parsed = new Date(`${named[1]} ${named[2]}, ${named[3]} 12:00:00 UTC`);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    if (response.ok) return parsed;
    const rateLimited = response.status === 429 || parsed?.error === "rate_limit_error";
    if (!rateLimited || attempt >= 4) {
      throw new Error(`${options.method || "GET"} ${url} failed (${response.status}): ${raw.slice(0, 500)}`);
    }
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const waitMs = Math.max(15_000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
    console.log(`[agenda-pin] rate limited; retrying in ${waitMs}ms`);
    await sleep(waitMs);
  }
  throw new Error(`request retries exhausted: ${url}`);
}

async function login(instance, username, password) {
  const data = await requestJson(`${instance}/api/v3/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username_or_email: username, password }),
  });
  const token = String(data?.jwt || "").trim();
  if (!token) throw new Error("Lemmy login response missing jwt");
  return token;
}

async function setFeatured(instance, token, postId, featured) {
  await requestJson(`${instance}/api/v3/post/feature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ post_id: postId, featured, feature_type: "Community" }),
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const envFile = loadEnvFallbacks(process.cwd());
  const secret = readSecrets(process.cwd());
  const username = String(
    process.env.LEMMY_MOD_USERNAME
    || envFile.LEMMY_MOD_USERNAME
    || process.env.MEETING_PUBLISH_USERNAME
    || envFile.MEETING_PUBLISH_USERNAME
    || secret["meeting publish username"]
    || (args.community === "owen-sound-council" ? secret["owen sound reporter username"] : "")
    || (args.community === "grey-county-council" ? secret["grey county reporter username"] : "")
    || ""
  ).trim();
  const password = String(
    process.env.LEMMY_MOD_PASSWORD
    || envFile.LEMMY_MOD_PASSWORD
    || process.env.MEETING_PUBLISH_PASSWORD
    || envFile.MEETING_PUBLISH_PASSWORD
    || secret["meeting publish password"]
    || (args.community === "owen-sound-council" ? secret["owen sound reporter password"] : "")
    || (args.community === "grey-county-council" ? secret["grey county reporter password"] : "")
    || ""
  ).trim();
  const instance = args.instance.replace(/\/+$/u, "");
  const today = args.today || torontoDateIso();
  const listing = await requestJson(`${instance}/api/v3/post/list?community_name=${encodeURIComponent(args.community)}&sort=New&limit=50`);
  const agendaPosts = (listing?.posts || [])
    .map((view) => ({ post: view.post, date: agendaDateFromPost(view.post) }))
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date) || b.post.id - a.post.id);
  const upcoming = agendaPosts.filter((item) => item.date >= today);
  const selected = upcoming.length ? upcoming[upcoming.length - 1] : null;
  const changes = agendaPosts
    .filter((item) => Boolean(item.post.featured_community) !== Boolean(selected && item.post.id === selected.post.id))
    .map((item) => ({
      postId: item.post.id,
      title: item.post.name,
      date: item.date,
      featured: Boolean(selected && item.post.id === selected.post.id),
    }));

  console.log(`[agenda-pin] community=${args.community} today=${today} selected=${selected?.post?.id || "none"} changes=${changes.length}`);
  for (const change of changes) console.log(`[agenda-pin] ${change.featured ? "pin" : "unpin"} ${change.postId} date=${change.date} ${change.title}`);
  if (args.dryRun || !changes.length) return;
  const configuredToken = String(process.env.LEMMY_MOD_JWT || envFile.LEMMY_MOD_JWT || "").trim();
  if (!configuredToken && (!username || !password)) {
    throw new Error("moderator authorization missing; set LEMMY_MOD_JWT or LEMMY_MOD_USERNAME and LEMMY_MOD_PASSWORD");
  }
  const token = configuredToken || await login(instance, username, password);
  for (const change of changes) await setFeatured(instance, token, change.postId, change.featured);
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
