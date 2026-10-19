import fs from "node:fs";

// This is the cross-house contract for transcript speaker attribution.  The
// audio service may still keep an internal voice key, but rendered output is
// anonymous unless a separate, evidence-backed identity pass is explicitly
// enabled.
export const SPEAKER_DIARIZATION_POLICY_VERSION = "sentence-cue-anonymous-v1";

function truthy(value) {
  return /^(1|true|yes|on)$/iu.test(String(value ?? "").trim());
}
export function namedSpeakerIdentityEnabled(env = process.env) {
  return truthy(env.PYA_SPEAKER_NAME_LINKING) || truthy(env.PYA_SPEAKER_IDENTITY_VERIFIED);
}

export function buildSentenceDiarizationEnv(base = {}, env = process.env) {
  return {
    ...base,
    // These are policy values, not per-meeting tuning knobs.  In particular,
    // no caller can accidentally turn sentence attribution into block-level
    // relabeling by inheriting a stale environment variable.
    PYA_SPEAKER_SENTENCE_ONLY: "1",
    PYA_SPEAKER_CUE_LEVEL_TURNS: "1",
    PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS: "1",
    PYA_SPEAKER_BAD_SAMPLE_GUARD: "1",
    PYA_SPEAKER_BOUNDARY_REFINE: String(env.PYA_SPEAKER_BOUNDARY_REFINE || "0"),
  };
}

export function isDefaultSpeakerLabel(label) {
  return /^(?:SPEAKER_\d{3}|SPEAKER_UNKNOWN)$/iu.test(String(label || "").trim());
}

export function speakerArtifactUsesDefaultLabels(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    if (/\.json$/iu.test(filePath)) {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      return rows.length > 0 && rows.every((row) => isDefaultSpeakerLabel(row?.display));
    }
    const text = fs.readFileSync(filePath, "utf8");
    const labels = [...text.matchAll(/^([^\r\n:]+):\s+/gmu)].map((match) => match[1].trim());
    return labels.length > 0 && labels.every(isDefaultSpeakerLabel);
  } catch {
    return false;
  }
}
