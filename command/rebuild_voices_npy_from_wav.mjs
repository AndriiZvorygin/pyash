#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureStarted, enrol, discharge, stop } from "./speaker_runner.mjs";

function usage() {
  return [
    "Usage: node command/rebuild_voices_npy_from_wav.mjs <voices_dir> [min_seconds] [backup_dir]",
    "Example: node command/rebuild_voices_npy_from_wav.mjs world/voices 1.2 /tmp/voices-backup",
  ].join("\n");
}

function getDurationSeconds(filePath) {
  try {
    const out = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { encoding: "utf8" }).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function listVoiceKeys(voicesDir) {
  return fs.readdirSync(voicesDir)
    .filter((n) => n.endsWith(".wav"))
    .map((n) => n.replace(/\.wav$/u, ""))
    .sort();
}

async function main() {
  const voicesDirArg = process.argv[2];
  if (!voicesDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }
  const voicesDir = path.resolve(process.cwd(), voicesDirArg);
  const minSecondsRaw = Number(process.argv[3] || 1.2);
  const minSeconds = Number.isFinite(minSecondsRaw) && minSecondsRaw > 0 ? minSecondsRaw : 1.2;
  const backupDirArg = process.argv[4] || "";
  const backupDir = backupDirArg ? path.resolve(process.cwd(), backupDirArg) : "";
  const speakerHost = String(process.env.PYA_SPEAKER_HOST || process.env.SPEAKER_HOST || "").trim();

  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`voices directory missing: ${voicesDir}`);
  if (speakerHost) {
    throw new Error(
      `rebuild_voices_npy_from_wav requires local speaker worker (unset PYA_SPEAKER_HOST/SPEAKER_HOST). current=${speakerHost}`
    );
  }

  const keys = listVoiceKeys(voicesDir);
  if (!keys.length) {
    process.stdout.write("[rebuild-voices] no wav samples found\n");
    return;
  }

  process.stdout.write(`[rebuild-voices] voices: ${voicesDir}\n`);
  process.stdout.write(`[rebuild-voices] min_seconds: ${minSeconds}\n`);
  if (backupDir) process.stdout.write(`[rebuild-voices] backup: ${backupDir}\n`);

  if (backupDir) fs.mkdirSync(backupDir, { recursive: true });

  await ensureStarted();
  let rebuilt = 0;
  let skippedShort = 0;
  let failed = 0;

  try {
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const wavPath = path.join(voicesDir, `${key}.wav`);
      const npyPath = path.join(voicesDir, `${key}.npy`);
      const pyaPath = path.join(voicesDir, `${key}.pya`);
      const duration = getDurationSeconds(wavPath);

      if (duration < minSeconds) {
        skippedShort += 1;
        process.stdout.write(`[rebuild-voices] skip short ${key} dur=${duration.toFixed(2)}s\n`);
        continue;
      }

      const pyaOriginal = fs.existsSync(pyaPath) ? fs.readFileSync(pyaPath, "utf8") : "";
      try {
        if (backupDir && fs.existsSync(npyPath)) {
          fs.copyFileSync(npyPath, path.join(backupDir, `${key}.npy`));
        }
        if (backupDir && fs.existsSync(pyaPath)) {
          fs.copyFileSync(pyaPath, path.join(backupDir, `${key}.pya`));
        }

        if (fs.existsSync(npyPath)) fs.unlinkSync(npyPath);

        // Enrol with the speaker key so the service regenerates key.npy deterministically.
        await enrol({
          audio: wavPath,
          name: key,
          voicesDir,
          clipSeconds: Math.max(1.2, Math.min(12, duration)),
        });

        // Restore metadata exactly to keep existing identity naming untouched.
        if (pyaOriginal) fs.writeFileSync(pyaPath, pyaOriginal, "utf8");

        rebuilt += 1;
        process.stdout.write(`[rebuild-voices] rebuilt ${i + 1}/${keys.length} ${key} dur=${duration.toFixed(2)}s\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`[rebuild-voices] fail ${key}: ${String(error?.message || error)}\n`);
      }
    }
  } finally {
    try { await discharge(); } catch {}
    try { await stop(); } catch {}
  }

  process.stdout.write(`[rebuild-voices] rebuilt=${rebuilt} skipped_short=${skippedShort} failed=${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
});
