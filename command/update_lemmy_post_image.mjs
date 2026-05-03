#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_INSTANCE = "https://helpos.ca";

function usage() {
  return [
    "Usage: node command/update_lemmy_post_image.mjs --post-ref <id> --image <path> [--instance <url>] [--dry-run] [--expected-title-hash <sha256>] [--expected-body-hash <sha256>]",
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
  };

  while (args.length) {
    const a = args.shift();
    if (a === "--post-ref") out.postRef = String(args.shift() || "").trim();
    else if (a === "--image") out.imagePath = String(args.shift() || "").trim();
    else if (a === "--instance") out.instance = String(args.shift() || "").trim();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--expected-title-hash") out.expectedTitleHash = String(args.shift() || "").trim().toLowerCase();
    else if (a === "--expected-body-hash") out.expectedBodyHash = String(args.shift() || "").trim().toLowerCase();
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

async function fetchLivePost({ instance, postRef }) {
  const endpoint = `${String(instance).replace(/\/+$/u, "")}/api/v3/post?id=${encodeURIComponent(postRef)}`;
  const res = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(30000) });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`live post read failed (${res.status}): ${raw.slice(0, 600)}`);
  const post = parsed?.post_view?.post || null;
  if (!post) throw new Error("live post response missing post_view.post");
  return { endpoint, parsed, post };
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

async function uploadImage({ instance, token, imagePath, mime }) {
  const endpoint = `${String(instance).replace(/\/+$/u, "")}/api/v3/image`;
  const form = new FormData();
  const imageBuf = fs.readFileSync(imagePath);
  form.append("image", new Blob([imageBuf], { type: mime || "application/octet-stream" }), path.basename(imagePath));
  form.append("auth", token);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  if (!res.ok) throw new Error(`image upload failed (${res.status}): ${raw.slice(0, 600)}`);
  const imageUrl = extractImageUrlFromUploadResponse(parsed);
  if (!imageUrl) throw new Error(`image upload succeeded but response had no image url: ${raw.slice(0, 300)}`);
  return { endpoint, parsed, imageUrl };
}

async function editPostImage({ instance, token, postId, title, body, imageUrl, languageId }) {
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
    const res = await fetch(endpoint, {
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

async function main() {
  const args = parseArgs(process.argv);
  const envFallback = loadEnvFallbacks(process.cwd());
  const token = String(process.env.MEETING_PUBLISH_AUTH_TOKEN || envFallback.MEETING_PUBLISH_AUTH_TOKEN || "").trim();

  const imagePath = path.resolve(process.cwd(), args.imagePath);
  const reportDir = path.join(process.cwd(), "artifacts", `post-image-update-${Date.now()}`);
  const preflightPath = path.join(reportDir, "post-image-update.preflight.pya");
  const resultPath = path.join(reportDir, "post-image-update.result.pya");

  const image = await probeImage(imagePath);
  if (!image.exists) throw new Error(`image not found: ${imagePath}`);
  if (!image.width || !image.height) throw new Error(`image probe failed: ${imagePath}`);

  const before = await fetchLivePost({ instance: args.instance, postRef: args.postRef });
  const liveTitle = String(before.post?.name || "");
  const liveBody = String(before.post?.body || "");
  const hashCheck = verifyExpectedHashes({
    title: liveTitle,
    body: liveBody,
    expectedTitleHash: args.expectedTitleHash,
    expectedBodyHash: args.expectedBodyHash,
  });

  const preflight = {
    mode: args.dryRun ? "dry_run" : "live",
    instance: args.instance,
    postRef: args.postRef,
    liveReadEndpoint: before.endpoint,
    liveTitle: liveTitle,
    liveTitleHash: hashCheck.titleHash,
    liveBodyHash: hashCheck.bodyHash,
    liveUrl: String(before.post?.url || ""),
    liveThumbnailUrl: String(before.post?.thumbnail_url || ""),
    liveCommunityId: Number(before.post?.community_id || 0),
    liveLanguageId: Number(before.post?.language_id || 0),
    imagePath,
    imageWidth: image.width,
    imageHeight: image.height,
    imageBytes: image.bytes,
    expectedTitleHash: args.expectedTitleHash,
    expectedBodyHash: args.expectedBodyHash,
    expectationErrors: hashCheck.errors,
    tokenPresent: Boolean(token),
    plannedUploadEndpoint: `${String(args.instance).replace(/\/+$/u, "")}/api/v3/image`,
    plannedEditEndpoint: `${String(args.instance).replace(/\/+$/u, "")}/api/v3/post/edit`,
  };
  writePya(preflightPath, preflight);

  if (hashCheck.errors.length) {
    writePya(resultPath, { pass: false, reason: "expected_hash_mismatch", preflightPath, errors: hashCheck.errors });
    throw new Error(`aborted: ${hashCheck.errors.join(", ")}`);
  }

  if (args.dryRun) {
    writePya(resultPath, {
      pass: true,
      mode: "dry_run",
      preflightPath,
      result: "no_upload_no_edit",
      plannedPreserveTitleHash: hashCheck.titleHash,
      plannedPreserveBodyHash: hashCheck.bodyHash,
      plannedTargetPostRef: args.postRef,
    });
    process.stdout.write(`[post-image-update] dry-run preflight: ${preflightPath}\n`);
    process.stdout.write(`[post-image-update] dry-run result: ${resultPath}\n`);
    process.stdout.write(`[post-image-update] live title hash: ${hashCheck.titleHash}\n`);
    process.stdout.write(`[post-image-update] live body hash: ${hashCheck.bodyHash}\n`);
    process.stdout.write(`[post-image-update] planned upload endpoint: ${preflight.plannedUploadEndpoint}\n`);
    process.stdout.write(`[post-image-update] planned edit endpoint: ${preflight.plannedEditEndpoint}\n`);
    process.exit(0);
  }

  if (!token) throw new Error("MEETING_PUBLISH_AUTH_TOKEN is required for non-dry-run image update");

  const uploaded = await uploadImage({ instance: args.instance, token, imagePath, mime: image.mime });
  const edited = await editPostImage({
    instance: args.instance,
    token,
    postId: args.postRef,
    title: liveTitle,
    body: liveBody,
    imageUrl: uploaded.imageUrl,
    languageId: Number(before.post?.language_id || 0),
  });

  const after = await fetchLivePost({ instance: args.instance, postRef: args.postRef });
  const afterTitle = String(after.post?.name || "");
  const afterBody = String(after.post?.body || "");
  const afterTitleHash = sha256Text(afterTitle);
  const afterBodyHash = sha256Text(afterBody);
  const afterUrl = String(after.post?.url || "");

  const failures = [];
  if (afterTitleHash !== hashCheck.titleHash) failures.push("title_drift_detected");
  if (afterBodyHash !== hashCheck.bodyHash) failures.push("body_drift_detected");
  if (!afterUrl || afterUrl === String(before.post?.url || "")) failures.push("image_url_not_changed");

  const result = {
    pass: failures.length === 0,
    mode: "live",
    preflightPath,
    uploadEndpoint: uploaded.endpoint,
    uploadedImageUrl: uploaded.imageUrl,
    editEndpoint: edited.endpoint,
    editMethod: edited.method,
    beforeUrl: String(before.post?.url || ""),
    afterUrl,
    beforeTitleHash: hashCheck.titleHash,
    afterTitleHash,
    beforeBodyHash: hashCheck.bodyHash,
    afterBodyHash,
    failures,
    rollbackInstruction: failures.length
      ? `Re-run full publisher update with known-good payload and post-ref ${args.postRef}`
      : "",
  };
  writePya(resultPath, result);

  if (failures.length) {
    throw new Error(`post-image-update drift check failed: ${failures.join(", ")}`);
  }

  process.stdout.write(`[post-image-update] success result: ${resultPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
    process.exit(1);
  });
}
