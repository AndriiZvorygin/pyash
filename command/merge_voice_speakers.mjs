#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureStarted, enrol, discharge, stop } from "./speaker_runner.mjs";

function usage() {
  return [
    "Usage: node command/merge_voice_speakers.mjs <voices_dir> <from_speaker_key> <to_speaker_key> [--apply] [--keep-source]",
    "Example: node command/merge_voice_speakers.mjs world/voices speaker_652 speaker_015 --apply",
    "Behavior:",
    "- Chooses better wav sample by duration (longer wins).",
    "- Rebuilds target .npy from chosen wav via speaker service/worker enrol.",
    "- Preserves target stable name; if missing, falls back to source name.",
    "- Drops source artifacts unless --keep-source is set.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    voicesDir: "",
    fromKey: "",
    toKey: "",
    apply: false,
    keepSource: false,
  };
  const pos = [];
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] || "").trim();
    if (!a) continue;
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a === "--keep-source") {
      out.keepSource = true;
      continue;
    }
    if (a.startsWith("-")) throw new Error(`unknown arg: ${a}`);
    pos.push(a);
  }
  if (pos.length < 3) throw new Error(usage());
  out.voicesDir = path.resolve(process.cwd(), pos[0]);
  out.fromKey = String(pos[1] || "").trim().toLowerCase();
  out.toKey = String(pos[2] || "").trim().toLowerCase();
  return out;
}

function isSpeakerKey(v) {
  return /^speaker_\d+$/iu.test(String(v || "").trim());
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function getDurationSeconds(filePath) {
  if (!isFile(filePath)) return 0;
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

function readMetaField(metaPath, field) {
  if (!isFile(metaPath)) return "";
  const src = fs.readFileSync(metaPath, "utf8");
  const re = new RegExp(`^\\s*su name ${field} ob text \"(.*)\" ya\\s*$`, "mu");
  const m = src.match(re);
  return String(m?.[1] || "").trim();
}

function readMetaNum(metaPath, field) {
  if (!isFile(metaPath)) return 0;
  const src = fs.readFileSync(metaPath, "utf8");
  const re = new RegExp(`^\\s*su name ${field} ob num ([0-9]+(?:\\.[0-9]+)?) ya\\s*$`, "mu");
  const m = src.match(re);
  const n = Number(m?.[1] || 0);
  return Number.isFinite(n) ? n : 0;
}

function writeOrReplaceTextField(src, field, value) {
  const line = `su name ${field} ob text "${String(value || "").replace(/"/gu, '\\"')}" ya`;
  const re = new RegExp(`^\\s*su name ${field} ob text \".*\" ya\\s*$`, "mu");
  if (re.test(src)) return src.replace(re, line);
  return `${src.trimEnd()}\n${line}\n`;
}

function writeOrReplaceNumField(src, field, value) {
  const line = `su name ${field} ob num ${String(value)} ya`;
  const re = new RegExp(`^\\s*su name ${field} ob num [0-9]+(?:\\.[0-9]+)? ya\\s*$`, "mu");
  if (re.test(src)) return src.replace(re, line);
  return `${src.trimEnd()}\n${line}\n`;
}

function ensureMeta(metaPath, speakerKey, fallbackName = "") {
  if (isFile(metaPath)) return;
  const now = new Date().toISOString();
  const baseName = String(fallbackName || speakerKey).trim() || speakerKey;
  const text = [
    "su name speaker metadata be map def",
    `su name created_at ob text "${now}" ya`,
    `su name name ob text "${baseName}" ya`,
    "su name origin ob text \"merge\" ya",
    "su name sample_count ob num 0 ya",
    `su name speaker ob text "${speakerKey}" ya`,
    `su name updated_at ob text "${now}" ya`,
    "prah",
    "",
  ].join("\n");
  fs.writeFileSync(metaPath, text, "utf8");
}

function removeSpeakerArtifacts(voicesDir, speakerKey) {
  for (const ext of [".wav", ".npy", ".pya"]) {
    const p = path.join(voicesDir, `${speakerKey}${ext}`);
    if (isFile(p)) fs.unlinkSync(p);
  }
}

async function main() {
  const { voicesDir, fromKey, toKey, apply, keepSource } = parseArgs(process.argv);
  if (!isSpeakerKey(fromKey)) throw new Error(`invalid from_speaker_key: ${fromKey}`);
  if (!isSpeakerKey(toKey)) throw new Error(`invalid to_speaker_key: ${toKey}`);
  if (fromKey === toKey) throw new Error("from_speaker_key and to_speaker_key must differ");

  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`voices dir not found: ${voicesDir}`);

  const fromWav = path.join(voicesDir, `${fromKey}.wav`);
  const toWav = path.join(voicesDir, `${toKey}.wav`);
  const fromNpy = path.join(voicesDir, `${fromKey}.npy`);
  const toNpy = path.join(voicesDir, `${toKey}.npy`);
  const fromPya = path.join(voicesDir, `${fromKey}.pya`);
  const toPya = path.join(voicesDir, `${toKey}.pya`);

  const fromDur = getDurationSeconds(fromWav);
  const toDur = getDurationSeconds(toWav);
  const chosen = (fromDur > toDur + 0.05 && isFile(fromWav)) ? "from" : "to";
  const chosenWav = chosen === "from" ? fromWav : toWav;
  const chosenDur = chosen === "from" ? fromDur : toDur;

  const fromName = readMetaField(fromPya, "name");
  const toName = readMetaField(toPya, "name");
  const mergedName = String(toName || fromName || toKey).trim();
  const sampleCount = Math.max(0, readMetaNum(fromPya, "sample_count")) + Math.max(0, readMetaNum(toPya, "sample_count"));
  const now = new Date().toISOString();

  process.stdout.write(`[voice-merge] voices: ${voicesDir}\n`);
  process.stdout.write(`[voice-merge] mode: ${apply ? "apply" : "dry-run"}\n`);
  process.stdout.write(`[voice-merge] from: ${fromKey} dur=${fromDur.toFixed(2)}s name=${fromName || "(none)"}\n`);
  process.stdout.write(`[voice-merge] to: ${toKey} dur=${toDur.toFixed(2)}s name=${toName || "(none)"}\n`);
  process.stdout.write(`[voice-merge] chosen sample: ${chosen} (${chosenDur.toFixed(2)}s)\n`);
  process.stdout.write(`[voice-merge] merged name: ${mergedName}\n`);
  process.stdout.write(`[voice-merge] merged sample_count: ${sampleCount}\n`);
  process.stdout.write(`[voice-merge] drop source: ${keepSource ? "no" : "yes"}\n`);

  if (!apply) return;
  ensureMeta(toPya, toKey, mergedName);
  if (chosen === "from" && isFile(fromWav)) {
    fs.copyFileSync(fromWav, toWav);
  }

  if (isFile(toWav)) {
    // Rebuild target embedding from selected wav.
    await ensureStarted();
    try {
      await enrol({
        audio: toWav,
        name: toKey,
        voicesDir,
        clipSeconds: Math.max(1.2, Math.min(8, chosenDur || 8)),
        // Merge is a maintenance operation over existing enrolled identities;
        // skip strict long-clip edge integrity to avoid blocking on mixed archival wav tails.
        edgeMinDurationSeconds: 999999,
      });
    } finally {
      try { await discharge(); } catch {}
      try { await stop(); } catch {}
    }
  } else {
    // No wav exists; keep current target embedding if present, otherwise promote source embedding.
    if (!isFile(toNpy) && isFile(fromNpy)) {
      fs.copyFileSync(fromNpy, toNpy);
    }
  }

  let toMetaSrc = isFile(toPya) ? fs.readFileSync(toPya, "utf8") : "";
  toMetaSrc = writeOrReplaceTextField(toMetaSrc, "name", mergedName);
  toMetaSrc = writeOrReplaceNumField(toMetaSrc, "sample_count", sampleCount);
  toMetaSrc = writeOrReplaceTextField(toMetaSrc, "updated_at", now);
  fs.writeFileSync(toPya, toMetaSrc.endsWith("\n") ? toMetaSrc : `${toMetaSrc}\n`, "utf8");

  if (!keepSource) {
    removeSpeakerArtifacts(voicesDir, fromKey);
  }
  process.stdout.write("[voice-merge] done\n");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
