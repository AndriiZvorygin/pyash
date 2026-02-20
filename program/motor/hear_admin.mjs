import { resolveConfigText } from "../configure/env.mjs";
import { dischargeWhisperx } from "../verbs/hear/whisperx.mjs";

export async function dischargeHearBackend({ rememberFn } = {}) {
  const backend = (resolveConfigText("hear backend default", { rememberFn }) || "whisper").trim().toLowerCase();
  if (backend !== "whisperx") {
    return { backend, discharged: false };
  }
  const host = resolveConfigText("hear host", { rememberFn }) || "http://localhost:8000";
  await dischargeWhisperx({ host });
  return { backend, discharged: true };
}
