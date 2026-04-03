#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  return [
    "Usage: node command/archive_low_signal_voices.mjs [voices_dir] [archive_dir]",
    "",
    "Archives low-signal unlabeled speaker artifacts (speaker_###.*) from global voices.",
    "Default voices_dir: world/voices",
    "Default archive_dir: world/voices/archive-low-signal-<YYYYMMDD-HHMMSS>",
    "",
    "Env:",
    "  PYA_VOICE_ARCHIVE_MAX_SAMPLE_COUNT  default: 3",
    "  PYA_VOICE_ARCHIVE_MAX_WAV_BYTES      default: 120000",
    "  PYA_VOICE_ARCHIVE_DRY_RUN=1          print-only, do not move files",
  ].join("\n");
}

function parsePyaFields(filePath) {
  const out = {};
  const text = fs.readFileSync(filePath, "utf8");
  const re = /^\s*su name (.+?) ob (.+?) ya\s*$/gmu;
  let m;
  while ((m = re.exec(text))) {
    const key = String(m[1] || "").trim();
    const body = String(m[2] || "").trim();
    if (body.startsWith("text ")) {
      const q = body.slice(5).trim();
      try {
        out[key] = JSON.parse(q);
      } catch {
        out[key] = q.replace(/^"|"$/gu, "");
      }
      continue;
    }
    if (body.startsWith("num ")) {
      const n = Number(body.slice(4).trim());
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

function tsStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function isCanonicalName(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  return !/^speaker_\d+$/iu.test(raw);
}

function shouldArchive(meta, wavBytes, maxSampleCount, maxWavBytes) {
  const key = String(meta.key || meta.speaker || "").trim();
  const name = String(meta.name || "").trim();
  if (!/^speaker_\d+$/iu.test(key)) return false;
  if (isCanonicalName(name)) return false;

  const sampleCount = Number(meta.sample_count);
  const sampleOk = Number.isFinite(sampleCount) ? sampleCount <= maxSampleCount : true;
  const wavOk = Number.isFinite(Number(wavBytes)) ? Number(wavBytes) <= maxWavBytes : true;
  return sampleOk && wavOk;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const voicesDir = path.resolve(process.cwd(), process.argv[2] || path.join(root, "world/voices"));
  const archiveDir = path.resolve(
    process.cwd(),
    process.argv[3] || path.join(voicesDir, `archive-low-signal-${tsStamp()}`)
  );

  const maxSampleCount = (() => {
    const raw = Number(process.env.PYA_VOICE_ARCHIVE_MAX_SAMPLE_COUNT || 3);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 3;
  })();
  const maxWavBytes = (() => {
    const raw = Number(process.env.PYA_VOICE_ARCHIVE_MAX_WAV_BYTES || 120000);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 120000;
  })();
  const dryRun = /^(1|true|yes)$/iu.test(String(process.env.PYA_VOICE_ARCHIVE_DRY_RUN || "0"));

  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) {
    throw new Error(`voices directory not found: ${voicesDir}`);
  }

  const metas = fs.readdirSync(voicesDir)
    .filter((n) => /^speaker_\d+\.pya$/iu.test(n))
    .sort();

  let moved = 0;
  let skipped = 0;
  const movedKeys = [];

  for (const pyaName of metas) {
    const key = pyaName.replace(/\.pya$/u, "");
    const pyaPath = path.join(voicesDir, pyaName);
    let meta = {};
    try {
      meta = parsePyaFields(pyaPath);
    } catch {
      skipped += 1;
      continue;
    }
    if (!meta.key) meta.key = key;
    if (!meta.speaker) meta.speaker = key;

    const wavPath = path.join(voicesDir, `${key}.wav`);
    const wavSt = fs.statSync(wavPath, { throwIfNoEntry: false });
    const wavBytes = wavSt?.isFile() ? Number(wavSt.size || 0) : 0;
    if (!shouldArchive(meta, wavBytes, maxSampleCount, maxWavBytes)) {
      skipped += 1;
      continue;
    }

    movedKeys.push(key);
    if (dryRun) continue;
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const ext of [".pya", ".npy", ".wav"]) {
      const src = path.join(voicesDir, `${key}${ext}`);
      if (!fs.existsSync(src)) continue;
      fs.renameSync(src, path.join(archiveDir, `${key}${ext}`));
    }
    moved += 1;
  }

  process.stdout.write(`[voice-archive] voices: ${voicesDir}\n`);
  process.stdout.write(`[voice-archive] archive: ${archiveDir}\n`);
  process.stdout.write(`[voice-archive] dry_run: ${dryRun ? "on" : "off"}\n`);
  process.stdout.write(`[voice-archive] thresholds: max_sample_count=${maxSampleCount} max_wav_bytes=${maxWavBytes}\n`);
  process.stdout.write(`[voice-archive] candidates: ${metas.length}\n`);
  process.stdout.write(`[voice-archive] moved: ${dryRun ? movedKeys.length : moved}\n`);
  process.stdout.write(`[voice-archive] skipped: ${skipped}\n`);
  if (movedKeys.length) {
    process.stdout.write(`[voice-archive] keys: ${movedKeys.join(", ")}\n`);
  }
}

main();
