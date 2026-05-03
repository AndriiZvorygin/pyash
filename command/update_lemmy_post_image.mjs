#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readPyaTextValues } from "./pya_lookup.mjs";

const DEFAULT_INSTANCE = "https://helpos.ca";
const BACKEND_IMAGE_UPDATE_PATH = "/api/helpos/v1/post-image-update";

function usage() {
  return [
    "Usage: node command/update_lemmy_post_image.mjs --post-ref <id> --image <path> [--instance <url>] [--dry-run] [--expected-title-hash <sha256>] [--expected-body-hash <sha256>] [--direct-pictrs]",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = [...argv.slice(2)];
  const out = {
    postRef: "",
    imagePath: "",
    instance: DEFAULT_INSTANCE,
    dryRun: false,
    expectedTitleHash: "",
    expectedBodyHash: "",
    directPictrs: false,
  };

  while (args.length) {
    const a = args.shift();
    if (a === "--post-ref") out.postRef = String(args.shift() || "").trim();
    else if (a === "--image") out.imagePath = String(args.shift() || "").trim();
    else if (a === "--instance") out.instance = String(args.shift() || "").trim();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--expected-title-hash") out.expectedTitleHash = String(args.shift() || "").trim().toLowerCase();
    else if (a === "--expected-body-hash") out.expectedBodyHash = String(args.shift() || "").trim().toLowerCase();
    else if (a === "--direct-pictrs") out.directPictrs = true;
    else throw new Error(`unknown arg: ${a}`);
  }

  if (!out.postRef || !/^\d+$/u.test(out.postRef)) throw new Error("--post-ref must be numeric post id");
  if (!out.imagePath) throw new Error("--image is required");
  if (!out.instance) throw new Error("--instance must be non-empty");
  return out;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
  const dirs = [];
  let cur = path.resolve(cwdDir);
  while (true) {
    dirs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const merged = {};
  for (const dir of dirs.reverse()) Object.assign(merged, readEnvFileIfExists(path.join(dir, ".env")));
  return merged;
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
    "meeting publish auth token",
    "meeting publish username",
    "meeting publish password",
    "grey county reporter username",
    "grey county reporter password",
    "owen sound reporter username",
    "owen sound reporter password",
  ]);
}

export function sha256Text(input) {
  return crypto.createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

export function verifyExpectedHashes({ title, body, expectedTitleHash, expectedBodyHash }) {
  const titleHash = sha256Text(title);
  const bodyHash = sha256Text(body);
  const errors = [];
  if (expectedTitleHash && titleHash !== String(expectedTitleHash).toLowerCase()) errors.push("expected_title_hash_mismatch");
  if (expectedBodyHash && bodyHash !== String(expectedBodyHash).toLowerCase()) errors.push("expected_body_hash_mismatch");
  return { titleHash, bodyHash, errors };
}

function pyaQuote(text) {
  return `"${String(text || "").replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function toPyaLines(obj, prefix = "") {
  const lines = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const name = prefix ? `${prefix} ${key}` : key;
    if (Array.isArray(value)) {
      if (!value.length) lines.push(`${name} count is 0.`);
      else {
        lines.push(`${name} count is ${value.length}.`);
        value.forEach((item, i) => {
          if (item && typeof item === "object") lines.push(...toPyaLines(item, `${name} ${i + 1}`));
          else lines.push(`${name} ${i + 1} is ${pyaQuote(String(item))}.`);
        });
      }
    } else if (value && typeof value === "object") {
      lines.push(...toPyaLines(value, name));
    } else if (typeof value === "boolean") {
      lines.push(`${name} is ${value ? "yes" : "no"}.`);
    } else if (typeof value === "number") {
      lines.push(`${name} is ${Number.isFinite(value) ? value : 0}.`);
    } else if (value == null) {
      lines.push(`${name} is ${pyaQuote("")}.`);
    } else {
      lines.push(`${name} is ${pyaQuote(String(value))}.`);
    }
  }
  return lines;
}

function writePya(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${toPyaLines(payload).join("\n")}\n`, "utf8");
}

function runProc(cmd, args, { cwd = process.cwd(), timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(5000, Number(timeoutMs) || 5000));
    child.stdout.on("data", (c) => { stdout += String(c || ""); });
    child.stderr.on("data", (c) => { stderr += String(c || ""); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${cmd} failed (code=${code ?? "null"} signal=${signal ?? ""}) ${stderr || stdout}`.trim()));
    });
  });
}

async function probeImage(imagePath) {
  const exists = fs.existsSync(imagePath);
  const out = { path: imagePath, exists, width: 0, height: 0, bytes: 0, mime: "" };
  if (!exists) return out;
  try { out.bytes = fs.statSync(imagePath).size; } catch {}
  const ext = path.extname(imagePath).toLowerCase();
  out.mime = ext === ".png" ? "image/png" : (ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream");
  try {
    const r = await runProc("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", imagePath]);
    const m = String(r.stdout || "").trim().match(/^(\d+)x(\d+)$/u);
    if (m) { out.width = Number(m[1]) || 0; out.height = Number(m[2]) || 0; }
  } catch {}
  return out;
}

async function fetchLivePost({ instance, postRef, fetchImpl = fetch }) {
  const endpoint = `${String(instance).replace(/\/+$/u, "")}/api/v3/post?id=${encodeURIComponent(postRef)}`;
  const res = await fetchImpl(endpoint, { method: "GET", signal: AbortSignal.timeout(30_000) });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`live post read failed (${res.status}): ${raw.slice(0, 600)}`);
  const post = parsed?.post_view?.post || null;
  if (!post) throw new Error("live post response missing post_view.post");
  return { endpoint, parsed, post };
}

async function lemmyLogin({ instance, username, password, fetchImpl = fetch }) {
  const endpoint = `${String(instance).replace(/\/+$/u, "")}/api/v3/user/login`;
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username_or_email: username, password }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`lemmy login failed (${res.status}) via ${endpoint}: ${raw.slice(0, 600)}`);
  const jwt = String(parsed?.jwt || parsed?.token || "").trim();
  if (!jwt) throw new Error(`lemmy login missing jwt via ${endpoint}`);
  return { endpoint, jwt };
}

function extractImageUrlFromUploadResponse(parsed) {
  const candidates = [
    parsed?.image_url,
    parsed?.url,
    parsed?.files?.[0]?.file,
    parsed?.files?.[0]?.url,
    parsed?.data?.image_url,
    parsed?.image?.url,
  ].filter((x) => typeof x === "string" && x.trim());
  return candidates.length ? candidates[0].trim() : "";
}

async function uploadImageDirectPictrs({ instance, token, imagePath, mime, fetchImpl = fetch }) {
  const endpoint = `${String(instance).replace(/\/+$/u, "")}/pictrs/image`;
  const form = new FormData();
  const imageBuf = fs.readFileSync(imagePath);
  form.append("images[]", new Blob([imageBuf], { type: mime || "application/octet-stream" }), path.basename(imagePath));
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`image upload failed (${res.status}) via ${endpoint}: ${raw.slice(0, 600)}`);
  const imageUrl = extractImageUrlFromUploadResponse(parsed);
  if (!imageUrl) throw new Error(`image upload succeeded but response had no image url: ${raw.slice(0, 300)}`);
  return { endpoint, parsed, imageUrl };
}

async function editPostImage({ instance, token, postId, title, body, imageUrl, languageId, fetchImpl = fetch }) {
  const clean = String(instance).replace(/\/+$/u, "");
  const endpointPrimary = `${clean}/api/v3/post/edit`;
  const bodyJson = {
    post_id: Number(postId),
    name: title,
    body,
    url: imageUrl,
    language_id: languageId || undefined,
    auth: token,
  };

  const tryRequest = async (endpoint, method) => {
    const res = await fetchImpl(endpoint, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(bodyJson),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    return { ok: res.ok, status: res.status, raw, parsed, endpoint, method };
  };

  let r = await tryRequest(endpointPrimary, "POST");
  if (!r.ok && (r.status === 404 || r.status === 405)) {
    const endpointV4 = `${clean}/api/v4/post`;
    r = await tryRequest(endpointV4, "PUT");
  }
  if (!r.ok) throw new Error(`post edit failed (${r.status}) via ${r.method} ${r.endpoint}: ${String(r.raw || "").slice(0, 600)}`);
  return r;
}

function buildIdempotencyKey({ postRef, expectedTitleHash, expectedBodyHash, imagePath, dryRun }) {
  const mode = dryRun ? "dry" : "live";
  const stamp = `${String(postRef)}|${String(expectedTitleHash)}|${String(expectedBodyHash)}|${path.basename(String(imagePath || ""))}|${mode}`;
  const digest = sha256Text(stamp).slice(0, 12);
  return `post-image-${postRef}-${mode}-${digest}-v1`;
}

async function callBackendImageUpdate({ instance, token, postRef, expectedTitleHash, expectedBodyHash, imagePath, mime, dryRun, idempotencyKey, fetchImpl = fetch }) {
  const endpoint = `${String(instance).replace(/\/+$/u, "")}${BACKEND_IMAGE_UPDATE_PATH}`;
  const form = new FormData();
  const metadata = {
    idempotency_key: idempotencyKey,
    post_id: Number(postRef),
    expected_title_hash: expectedTitleHash || "",
    expected_body_hash: expectedBodyHash || "",
    dry_run: Boolean(dryRun),
  };
  form.append("metadata", JSON.stringify(metadata));
  const imageBuf = fs.readFileSync(imagePath);
  form.append("cover_image", new Blob([imageBuf], { type: mime || "application/octet-stream" }), path.basename(imagePath));

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`post-image-update failed (${res.status}) via ${endpoint}: ${raw.slice(0, 1200)}`);
  return { endpoint, parsed, raw, metadata };
}

export async function runUpdate(argv, deps = {}) {
  const args = parseArgs(argv);
  const fetchImpl = deps.fetchImpl || fetch;
  const probeImageImpl = deps.probeImage || probeImage;
  const fetchLivePostImpl = deps.fetchLivePost || fetchLivePost;
  const backendUpdateImpl = deps.backendUpdate || callBackendImageUpdate;
  const lemmyLoginImpl = deps.lemmyLogin || lemmyLogin;
  const uploadImageImpl = deps.uploadImage || uploadImageDirectPictrs;
  const editPostImpl = deps.editPostImage || editPostImage;

  const envFallback = loadEnvFallbacks(process.cwd());
  const secret = readSecretValues(process.cwd());

  const token = String(
    process.env.MEETING_PUBLISH_AUTH_TOKEN
    || envFallback.MEETING_PUBLISH_AUTH_TOKEN
    || secret["meeting publish auth token"]
    || ""
  ).trim();
  const username = String(
    process.env.MEETING_PUBLISH_USERNAME
    || envFallback.MEETING_PUBLISH_USERNAME
    || process.env.OWEN_SOUND_REPORTER_USERNAME
    || envFallback.OWEN_SOUND_REPORTER_USERNAME
    || process.env.GREY_COUNTY_REPORTER_USERNAME
    || envFallback.GREY_COUNTY_REPORTER_USERNAME
    || secret["meeting publish username"]
    || secret["owen sound reporter username"]
    || secret["grey county reporter username"]
    || ""
  ).trim();
  const password = String(
    process.env.MEETING_PUBLISH_PASSWORD
    || envFallback.MEETING_PUBLISH_PASSWORD
    || process.env.OWEN_SOUND_REPORTER_PASSWORD
    || envFallback.OWEN_SOUND_REPORTER_PASSWORD
    || process.env.GREY_COUNTY_REPORTER_PASSWORD
    || envFallback.GREY_COUNTY_REPORTER_PASSWORD
    || secret["meeting publish password"]
    || secret["owen sound reporter password"]
    || secret["grey county reporter password"]
    || ""
  ).trim();

  const tokenSource = process.env.MEETING_PUBLISH_AUTH_TOKEN ? "env:MEETING_PUBLISH_AUTH_TOKEN"
    : envFallback.MEETING_PUBLISH_AUTH_TOKEN ? "envfile:MEETING_PUBLISH_AUTH_TOKEN"
      : secret["meeting publish auth token"] ? "secret:meeting publish auth token" : "missing";

  const imagePath = path.resolve(process.cwd(), args.imagePath);
  const reportDir = path.join(process.cwd(), "artifacts", `post-image-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const preflightPath = path.join(reportDir, "post-image-update.preflight.pya");
  const resultPath = path.join(reportDir, "post-image-update.result.pya");

  const updateMode = args.directPictrs ? "direct_pictrs" : "backend_endpoint";
  const endpoint = args.directPictrs
    ? `${String(args.instance).replace(/\/+$/u, "")}/pictrs/image`
    : `${String(args.instance).replace(/\/+$/u, "")}${BACKEND_IMAGE_UPDATE_PATH}`;
  const attempted = {
    updateMode,
    endpoint,
    editEndpoint: `${String(args.instance).replace(/\/+$/u, "")}/api/v3/post/edit`,
  };
  let preflight = null;

  const writeFailure = (failedStage, err, extra = {}) => {
    const titleHashMatches = preflight ? !preflight.expectationErrors?.includes("expected_title_hash_mismatch") : false;
    const bodyHashMatches = preflight ? !preflight.expectationErrors?.includes("expected_body_hash_mismatch") : false;
    writePya(resultPath, {
      pass: false,
      failedStage,
      updateMode,
      endpoint,
      error: String(err?.message || err || ""),
      preflightPath,
      idempotencyKey: preflight?.idempotencyKey || "",
      postId: args.postRef,
      expectedTitleHash: args.expectedTitleHash,
      expectedBodyHash: args.expectedBodyHash,
      oldImageUrl: preflight?.liveUrl || "",
      newImageUrl: extra.newImageUrl || "",
      titleHash: preflight?.liveTitleHash || "",
      bodyHash: preflight?.liveBodyHash || "",
      titleHashMatchesExpected: titleHashMatches,
      bodyHashMatchesExpected: bodyHashMatches,
      tokenSource,
      tokenPresent: Boolean(token),
      directPictrsRequested: args.directPictrs,
      pictrsAttempted: Boolean(extra.pictrsAttempted),
      rollbackNeeded: Boolean(extra.rollbackNeeded),
    });
  };

  let stage = "preflight";
  try {
    const image = await probeImageImpl(imagePath);
    if (!image.exists) {
      stage = "image_validation";
      throw new Error(`image not found: ${imagePath}`);
    }
    if (!image.width || !image.height) {
      stage = "image_validation";
      throw new Error(`image probe failed: ${imagePath}`);
    }

    const before = await fetchLivePostImpl({ instance: args.instance, postRef: args.postRef, fetchImpl });
    const liveTitle = String(before.post?.name || "");
    const liveBody = String(before.post?.body || "");
    const hashCheck = verifyExpectedHashes({
      title: liveTitle,
      body: liveBody,
      expectedTitleHash: args.expectedTitleHash,
      expectedBodyHash: args.expectedBodyHash,
    });

    const idempotencyKey = buildIdempotencyKey({
      postRef: args.postRef,
      expectedTitleHash: args.expectedTitleHash,
      expectedBodyHash: args.expectedBodyHash,
      imagePath,
      dryRun: args.dryRun,
    });

    preflight = {
      mode: args.dryRun ? "dry_run" : "live",
      updateMode,
      endpoint,
      instance: args.instance,
      postRef: args.postRef,
      idempotencyKey,
      liveReadEndpoint: before.endpoint,
      liveTitle: liveTitle,
      liveTitleHash: hashCheck.titleHash,
      liveBodyHash: hashCheck.bodyHash,
      liveUrl: String(before.post?.url || ""),
      liveThumbnailUrl: String(before.post?.thumbnail_url || ""),
      imagePath,
      imageWidth: image.width,
      imageHeight: image.height,
      imageBytes: image.bytes,
      expectedTitleHash: args.expectedTitleHash,
      expectedBodyHash: args.expectedBodyHash,
      expectationErrors: hashCheck.errors,
      tokenSource,
      tokenPresent: Boolean(token),
      directPictrsRequested: args.directPictrs,
      lemmyCredentialsPresent: Boolean(username && password),
    };
    writePya(preflightPath, preflight);

    if (hashCheck.errors.length) {
      stage = "hash_gate";
      throw new Error(`aborted: ${hashCheck.errors.join(", ")}`);
    }

    if (!token) {
      stage = "auth";
      throw new Error("MEETING_PUBLISH_AUTH_TOKEN is required");
    }

    if (!args.directPictrs) {
      stage = "backend_update";
      const backend = await backendUpdateImpl({
        instance: args.instance,
        token,
        postRef: args.postRef,
        expectedTitleHash: args.expectedTitleHash,
        expectedBodyHash: args.expectedBodyHash,
        imagePath,
        mime: image.mime,
        dryRun: args.dryRun,
        idempotencyKey,
        fetchImpl,
      });

      const summary = {
        pass: true,
        mode: args.dryRun ? "dry_run" : "live",
        updateMode,
        endpoint: backend.endpoint,
        preflightPath,
        idempotencyKey,
        postId: args.postRef,
        expectedTitleHash: args.expectedTitleHash,
        expectedBodyHash: args.expectedBodyHash,
        backendResponsePostUrl: String(backend.parsed?.post_url || ""),
        backendResponseImageUrl: String(backend.parsed?.image_url || backend.parsed?.post_image_url || ""),
        backendResponseStatus: String(backend.parsed?.status || "ok"),
        beforeUrl: String(before.post?.url || ""),
        afterUrl: String(backend.parsed?.image_url || backend.parsed?.post_image_url || before.post?.url || ""),
      };
      writePya(resultPath, summary);
      process.stdout.write(`[post-image-update] ${args.dryRun ? "dry-run" : "live"} result: ${resultPath}\n`);
      return { ok: true, dryRun: args.dryRun, preflightPath, resultPath };
    }

    // Legacy/debug-only direct Pictrs path
    stage = "direct_pictrs_auth";
    if (!username || !password) throw new Error("publisher username/password are required for --direct-pictrs mode");
    const login = await lemmyLoginImpl({ instance: args.instance, username, password, fetchImpl });

    stage = "direct_pictrs_upload";
    const uploaded = await uploadImageImpl({ instance: args.instance, token: login.jwt, imagePath, mime: image.mime, fetchImpl });

    if (args.dryRun) {
      writePya(resultPath, {
        pass: true,
        mode: "dry_run",
        updateMode,
        endpoint: uploaded.endpoint,
        preflightPath,
        idempotencyKey,
        postId: args.postRef,
        expectedTitleHash: args.expectedTitleHash,
        expectedBodyHash: args.expectedBodyHash,
        beforeUrl: String(before.post?.url || ""),
        afterUrl: String(before.post?.url || ""),
        note: "direct pictrs dry-run completed upload check only; no post edit",
      });
      return { ok: true, dryRun: true, preflightPath, resultPath };
    }

    stage = "direct_pictrs_edit";
    const edited = await editPostImpl({
      instance: args.instance,
      token,
      postId: args.postRef,
      title: liveTitle,
      body: liveBody,
      imageUrl: uploaded.imageUrl,
      languageId: Number(before.post?.language_id || 0),
      fetchImpl,
    });

    stage = "readback";
    const after = await fetchLivePostImpl({ instance: args.instance, postRef: args.postRef, fetchImpl });
    const afterTitleHash = sha256Text(String(after.post?.name || ""));
    const afterBodyHash = sha256Text(String(after.post?.body || ""));
    const afterUrl = String(after.post?.url || "");
    const failures = [];
    if (afterTitleHash !== hashCheck.titleHash) failures.push("title_drift_detected");
    if (afterBodyHash !== hashCheck.bodyHash) failures.push("body_drift_detected");
    if (!afterUrl || afterUrl === String(before.post?.url || "")) failures.push("image_url_not_changed");

    writePya(resultPath, {
      pass: failures.length === 0,
      mode: "live",
      updateMode,
      endpoint: uploaded.endpoint,
      preflightPath,
      idempotencyKey,
      postId: args.postRef,
      expectedTitleHash: args.expectedTitleHash,
      expectedBodyHash: args.expectedBodyHash,
      editEndpoint: edited.endpoint,
      beforeUrl: String(before.post?.url || ""),
      afterUrl,
      failures,
    });

    if (failures.length) throw new Error(`post-image-update drift check failed: ${failures.join(", ")}`);
    return { ok: true, dryRun: false, preflightPath, resultPath };
  } catch (err) {
    if (!fs.existsSync(resultPath)) {
      writeFailure(stage, err, { pictrsAttempted: stage.startsWith("direct_pictrs") || stage === "direct_pictrs_upload", rollbackNeeded: stage !== "preflight" && stage !== "hash_gate" && stage !== "image_validation" });
    }
    throw err;
  }
}

async function main() {
  const result = await runUpdate(process.argv);
  if (result?.preflightPath) process.stdout.write(`[post-image-update] preflight: ${result.preflightPath}\n`);
  if (result?.resultPath) process.stdout.write(`[post-image-update] result: ${result.resultPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
    process.exit(1);
  });
}
