#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_VOICES_DIR = "./world/voices";
const DEFAULT_TEMP_DIR = "./world/temporary/speaker";
const LOCAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_ROOT = String(process.env.PYA_SPEAKER_HOST_ROOT || "/workplace").trim() || "/workplace";

function isFiniteProvidedNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function resolvePathLike(value, fallback) {
  const raw = String(value ?? fallback ?? "").trim();
  return raw || fallback;
}

export class SpeakerRunner {
  constructor({
    pythonBin = process.env.PYA_PYTHON_BIN || "python3",
    workerPath = null,
    voicesDir = DEFAULT_VOICES_DIR,
    tempDir = DEFAULT_TEMP_DIR,
    cwd = process.cwd(),
  } = {}) {
    this.pythonBin = pythonBin;
    this.cwd = cwd;
    this.defaultVoicesDir = resolvePathLike(voicesDir, DEFAULT_VOICES_DIR);
    this.tempDir = resolvePathLike(tempDir, DEFAULT_TEMP_DIR);
    this.workerPath = workerPath || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "speaker_worker.py");
    this.serviceHost = String(process.env.PYA_SPEAKER_HOST || process.env.SPEAKER_HOST || "").trim().replace(/\/+$/u, "");

    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.stopped = false;
  }

  async ensureStarted() {
    if (this.serviceHost) {
      const url = `${this.serviceHost}/health`;
      const healthTimeoutMsRaw = Number(process.env.PYA_SPEAKER_HEALTH_TIMEOUT_MS || 8000);
      const healthTimeoutMs = Number.isFinite(healthTimeoutMsRaw) && healthTimeoutMsRaw > 0
        ? Math.floor(healthTimeoutMsRaw)
        : 8000;
      let res;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(healthTimeoutMs) });
      } catch (err) {
        throw new Error(`speaker service unavailable: ${url} (${err?.message || err})`);
      }
      if (!res.ok) {
        throw new Error(`speaker service unavailable: ${url} (${res.status} ${res.statusText})`);
      }
      return;
    }

    if (this.child && this.child.exitCode == null && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise((resolve, reject) => {
      const child = spawn(this.pythonBin, [
        "-u",
        this.workerPath,
        "--voices-dir", this.defaultVoicesDir,
        "--temp-dir", this.tempDir,
      ], {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      let settled = false;
      const failStart = (err) => {
        if (settled) return;
        settled = true;
        this.startPromise = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      child.on("error", (err) => {
        this.rejectAll(err);
        failStart(err);
      });

      child.on("exit", (code, signal) => {
        const reason = signal
          ? new Error(`speaker worker exited via signal ${signal}`)
          : new Error(`speaker worker exited with code ${code ?? "unknown"}`);
        this.child = null;
        this.buffer = "";
        this.startPromise = null;
        this.rejectAll(reason);
      });

      child.stdout.on("data", (chunk) => {
        this.handleStdoutChunk(String(chunk ?? ""));
      });

      child.stderr.on("data", () => {
        // Stderr is intentionally ignored by runner routing; worker logs remain available to process stderr.
      });

      this.child = child;
      this.stopped = false;
      settled = true;
      this.startPromise = null;
      resolve();
    });

    return this.startPromise;
  }

  handleStdoutChunk(chunk) {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx < 0) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;

      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }

      const id = payload?.id;
      if (id === undefined || id === null) continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);

      if (payload?.ok === true) {
        pending.resolve(payload?.result ?? {});
      } else {
        const message = payload?.error?.message || "speaker worker request failed";
        const err = new Error(String(message));
        err.payload = payload;
        pending.reject(err);
      }
    }
  }

  rejectAll(err) {
    for (const pending of this.pending.values()) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
    this.pending.clear();
  }

  async request(command, payload = {}) {
    if (this.serviceHost) {
      return this.requestViaService(command, payload);
    }

    await this.ensureStarted();
    if (!this.child || this.child.exitCode != null || this.child.killed) {
      throw new Error("speaker worker unavailable");
    }

    const id = this.nextId;
    this.nextId += 1;
    const request = { id, command, payload };

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    try {
      this.child.stdin.write(`${JSON.stringify(request)}\n`);
    } catch (err) {
      this.pending.delete(id);
      throw err;
    }

    return promise;
  }

  commandToEndpoint(command) {
    const key = String(command || "").trim().toLowerCase();
    if (key === "identify") return "/identify";
    if (key === "enrol") return "/enrol";
    if (key === "rename") return "/rename";
    if (key === "discharge") return "/discharge";
    if (key === "stop") return "/stop";
    throw new Error(`unknown speaker command: ${command}`);
  }

  async requestViaService(command, payload = {}) {
    await this.ensureStarted();
    const endpoint = this.commandToEndpoint(command);
    const url = `${this.serviceHost}${endpoint}`;
    const mappedPayload = this.mapPayloadForService(payload);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mappedPayload ?? {}),
      });
    } catch (err) {
      throw new Error(`speaker service defective: ${err?.message || err}`);
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      const msg = String(data?.error || `${res.status} ${res.statusText}`).trim();
      throw new Error(`speaker service defective: ${msg}`);
    }
    return data || {};
  }

  mapPathForService(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return raw;
    if (!path.isAbsolute(raw)) return raw;
    const localPrefix = `${LOCAL_ROOT}${path.sep}`;
    if (raw === LOCAL_ROOT) return SERVICE_ROOT;
    if (!raw.startsWith(localPrefix)) return raw;
    const rel = raw.slice(localPrefix.length).split(path.sep).join("/");
    return `${SERVICE_ROOT}/${rel}`;
  }

  mapPayloadForService(payload = {}) {
    if (!payload || typeof payload !== "object") return payload;
    const out = { ...payload };
    for (const key of ["voices_dir", "voicesDir"]) {
      if (typeof out[key] === "string") out[key] = this.mapPathForService(out[key]);
    }
    if (typeof out.audio === "string") {
      const audioRaw = String(out.audio || "").trim();
      out.audio = this.mapPathForService(audioRaw);
      if (audioRaw && path.isAbsolute(audioRaw) && fs.existsSync(audioRaw)) {
        try {
          out.audio_b64 = fs.readFileSync(audioRaw).toString("base64");
          out.audio_name = path.basename(audioRaw);
        } catch {
          // keep path-only payload when byte upload is unavailable
        }
      }
    }
    return out;
  }

  async identify({
    audio,
    prevSpeaker = null,
    voicesDir = this.defaultVoicesDir,
    sameSpeakerThreshold = null,
    knownSpeakerThreshold = null,
    clipSeconds = null,
    edgeCheckSeconds = null,
    edgeMinDurationSeconds = null,
    edgeMinSimilarity = null
  } = {}) {
    return this.request("identify", {
      audio,
      prev_speaker: prevSpeaker,
      voices_dir: voicesDir,
      ...(isFiniteProvidedNumber(sameSpeakerThreshold) ? { same_speaker_threshold: Number(sameSpeakerThreshold) } : {}),
      ...(isFiniteProvidedNumber(knownSpeakerThreshold) ? { known_speaker_threshold: Number(knownSpeakerThreshold) } : {}),
      ...(isFiniteProvidedNumber(clipSeconds) ? { clip_seconds: Number(clipSeconds) } : {}),
      ...(isFiniteProvidedNumber(edgeCheckSeconds) ? { edge_check_seconds: Number(edgeCheckSeconds) } : {}),
      ...(isFiniteProvidedNumber(edgeMinDurationSeconds) ? { edge_min_duration_seconds: Number(edgeMinDurationSeconds) } : {}),
      ...(isFiniteProvidedNumber(edgeMinSimilarity) ? { edge_min_similarity: Number(edgeMinSimilarity) } : {}),
    });
  }

  async enrol({
    audio,
    name,
    voicesDir = this.defaultVoicesDir,
    clipSeconds = null,
    edgeCheckSeconds = null,
    edgeMinDurationSeconds = null,
    edgeMinSimilarity = null
  } = {}) {
    return this.request("enrol", {
      audio,
      name,
      voices_dir: voicesDir,
      ...(isFiniteProvidedNumber(clipSeconds) ? { clip_seconds: Number(clipSeconds) } : {}),
      ...(isFiniteProvidedNumber(edgeCheckSeconds) ? { edge_check_seconds: Number(edgeCheckSeconds) } : {}),
      ...(isFiniteProvidedNumber(edgeMinDurationSeconds) ? { edge_min_duration_seconds: Number(edgeMinDurationSeconds) } : {}),
      ...(isFiniteProvidedNumber(edgeMinSimilarity) ? { edge_min_similarity: Number(edgeMinSimilarity) } : {}),
    });
  }

  async rename({ from, to, voicesDir = this.defaultVoicesDir } = {}) {
    return this.request("rename", {
      from,
      to,
      voices_dir: voicesDir,
    });
  }

  async discharge() {
    return this.request("discharge", {});
  }

  async stop() {
    if (this.serviceHost) {
      const result = await this.requestViaService("stop", {});
      this.stopped = true;
      return result;
    }

    if (!this.child || this.child.exitCode != null || this.child.killed) {
      this.child = null;
      return { stopped: true, alreadyStopped: true };
    }

    try {
      const result = await this.request("stop", {});
      this.stopped = true;
      return result;
    } finally {
      const child = this.child;
      this.child = null;
      this.buffer = "";
      if (child && child.exitCode == null && !child.killed) {
        child.kill("SIGTERM");
      }
    }
  }
}

const defaultRunner = new SpeakerRunner();

export async function ensureStarted() {
  return defaultRunner.ensureStarted();
}

export async function identify(args) {
  return defaultRunner.identify(args);
}

export async function enrol(args) {
  return defaultRunner.enrol(args);
}

export async function rename(args) {
  return defaultRunner.rename(args);
}

export async function discharge() {
  return defaultRunner.discharge();
}

export async function stop() {
  return defaultRunner.stop();
}

export default defaultRunner;
