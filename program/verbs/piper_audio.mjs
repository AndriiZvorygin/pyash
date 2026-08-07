import { spawn } from "node:child_process";

import { resolveConfigBool, resolveConfigText } from "../configure/env.mjs";
import { throwErrorSentence } from "../error.mjs";

export function resolveAudioPlayer({ rememberFn } = {}) {
  const configuredPlayer = resolveConfigText("audio player", { rememberFn });
  if (configuredPlayer) return configuredPlayer;
  if (process.platform === "darwin") return "afplay";
  if (process.platform === "win32") return null;
  return "aplay";
}

export async function playAudio(outputPath, { rememberFn } = {}) {
  if (resolveConfigBool("say silent", { rememberFn })) return;
  const player = resolveAudioPlayer({ rememberFn });
  if (!player) {
    throwErrorSentence({
      name: "piper say defective",
      message: "piper say defective: no audio player available",
      from: { name: "piper say" },
      raw: { outputPath }
    });
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(player, [outputPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code) {
        const detail = stderr.trim();
        reject(new Error(detail ? `player exited ${code}: ${detail}` : `player exited ${code}`));
      } else {
        resolve();
      }
    });
  });
}
