import { throwErrorSentence } from "../error.mjs";
import {
  ensureStarted as ensureSpeakerStarted,
  identify as identifySpeaker,
  enrol as enrolSpeaker,
  rename as renameSpeaker,
  discharge as dischargeSpeaker,
  stop as stopSpeaker,
} from "../../command/speaker_runner.mjs";
import { remember } from "../remember/index.mjs";

function resolveAction(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.text ?? sentence?.as?.name ?? "";
  return String(raw ?? "").trim().toLowerCase();
}

function resolveVoicesDir(sentence) {
  const text = sentence?.fromstate?.text;
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  // `fromstate wo audio` sets `fromstate.text` to "audio"; do not treat media type as voices directory.
  if (!trimmed || trimmed.toLowerCase() === "audio") return "";
  return trimmed || "";
}

function resolveAudioFilename(sentence) {
  const value = sentence?.from?.filename;
  if (typeof value !== "string") return "";
  return value.trim();
}

function resolveTextFromCase(value, { rememberFn = remember } = {}) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string" && value.text.trim()) return value.text.trim();
  if (typeof value.name === "string" && value.name.trim()) {
    const fact = rememberFn(value.name.trim());
    const text = String(fact?.ob?.text ?? "").trim();
    if (text) return text;
  }
  return "";
}

function resolveEnrollName(sentence) {
  const text = sentence?.ob?.text;
  if (typeof text !== "string") return "";
  return text.trim();
}

function resolveNumericFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const direct = Number(entry?.num);
  if (Number.isFinite(direct)) return direct;
  const obNum = Number(entry?.ob?.num);
  if (Number.isFinite(obNum)) return obNum;
  return null;
}

function resolveTextFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry?.text === "string" && entry.text.trim()) return entry.text.trim();
  if (typeof entry?.ob?.text === "string" && entry.ob.text.trim()) return entry.ob.text.trim();
  if (typeof entry?.name === "string" && entry.name.trim()) return entry.name.trim();
  if (typeof entry?.ob?.name === "string" && entry.ob.name.trim()) return entry.ob.name.trim();
  return "";
}

function resolveOptionsMap(sentence, { rememberFn = remember } = {}) {
  const withName = String(sentence?.with?.name ?? "").trim();
  if (!withName) return {};
  const fact = rememberFn(withName);
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") {
    throwErrorSentence({
      name: "speaker identity defective",
      message: "speaker identity defective: with name map missing",
      from: { name: "speaker identity" },
      raw: { withName }
    });
  }
  return map;
}

function canonicalOptionKey(value = "") {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function optionEntry(optionsMap = {}, aliases = []) {
  if (!optionsMap || typeof optionsMap !== "object") return undefined;
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(optionsMap, alias)) return optionsMap[alias];
  }
  const byCanonical = new Map();
  for (const [key, value] of Object.entries(optionsMap)) {
    byCanonical.set(canonicalOptionKey(key), value);
  }
  for (const alias of aliases) {
    const hit = byCanonical.get(canonicalOptionKey(alias));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export async function speakerIdentity(sentence, { remember: rememberFn = remember } = {}) {
  const action = resolveAction(sentence);
  const backend = String(rememberFn("speaker backend default")?.ob?.text ?? "local").trim().toLowerCase() || "local";
  const host = String(rememberFn("speaker host")?.ob?.text ?? "").trim();
  const useService = backend === "service" && host !== "";

  const callService = async (endpoint, payload = {}) => {
    const url = `${host.replace(/\/$/u, "")}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(data?.error ?? `${res.status} ${res.statusText}`).trim();
      throw new Error(`speaker service defective: ${msg}`);
    }
    return data;
  };

  if (action === "begin") {
    if (useService) {
      const res = await fetch(`${host.replace(/\/$/u, "")}/health`);
      if (!res.ok) throw new Error(`speaker service defective: ${res.status} ${res.statusText}`);
    } else {
      await ensureSpeakerStarted();
    }
    return { mood: "ya", be: "begin", as: { wo: "speaker identity" }, ob: { boolean: true } };
  }
  if (action === "discharge") {
    const result = useService ? await callService("/discharge", {}) : await dischargeSpeaker();
    return { mood: "ya", be: "discharge", as: { wo: "speaker identity" }, ob: { boolean: Boolean(result?.alive ?? true) } };
  }
  if (action === "stop") {
    if (useService) await callService("/stop", {});
    else await stopSpeaker();
    return { mood: "ya", be: "stop", as: { wo: "speaker identity" }, ob: { boolean: true } };
  }

  const fromText = resolveTextFromCase(sentence?.from, { rememberFn });
  const toText = resolveTextFromCase(sentence?.to, { rememberFn });
  if (fromText && toText && !resolveAudioFilename(sentence)) {
    try {
      const result = useService
        ? await callService("/rename", { from: fromText, to: toText })
        : await renameSpeaker({ from: fromText, to: toText });
      const speaker = String(result?.speaker ?? "").trim() || toText;
      return {
        mood: "ya",
        be: "rename",
        from: { name: "speaker identity" },
        ob: { text: speaker },
      };
    } catch (err) {
      throwErrorSentence({
        name: "speaker identity defective",
        message: `speaker identity defective: ${err?.message ?? err}`,
        from: { name: "speaker identity" },
        raw: { sentence },
      });
    }
  }

  const audio = resolveAudioFilename(sentence);
  if (!audio) {
    throwErrorSentence({
      name: "speaker identity input missing",
      message: "speaker identity input missing",
      from: { name: "speaker identity" },
      raw: { sentence },
    });
  }

  const voicesDir = resolveVoicesDir(sentence) || String(rememberFn("speaker voices dir")?.ob?.filename ?? "./world/voices");
  const enrollName = resolveEnrollName(sentence);
  const optionsMap = resolveOptionsMap(sentence, { rememberFn });
  const prevSpeaker = resolveTextFromMapEntry(optionEntry(optionsMap, ["prevSpeaker", "prev_speaker", "prev speaker"]));
  const sameSpeakerThreshold = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "sameSpeakerThreshold",
    "same_speaker_threshold",
    "same speaker threshold",
    "sameThreshold"
  ]));
  const knownSpeakerThreshold = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "knownSpeakerThreshold",
    "known_speaker_threshold",
    "known speaker threshold",
    "knownThreshold"
  ]));
  const mergeGuardThreshold = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "mergeGuardThreshold",
    "merge_guard_threshold",
    "merge guard threshold"
  ]));
  const clipSeconds = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "clipSeconds",
    "clip_seconds",
    "clip seconds",
    "seconds"
  ]));
  const edgeCheckSeconds = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "edgeCheckSeconds",
    "edge_check_seconds",
    "edge check seconds"
  ]));
  const edgeMinDurationSeconds = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "edgeMinDurationSeconds",
    "edge_min_duration_seconds",
    "edge min duration seconds"
  ]));
  const edgeMinSimilarity = resolveNumericFromMapEntry(optionEntry(optionsMap, [
    "edgeMinSimilarity",
    "edge_min_similarity",
    "edge min similarity"
  ]));
  const overrideVoicesDir = resolveTextFromMapEntry(optionEntry(optionsMap, [
    "voicesDir",
    "voices_dir",
    "voices dir"
  ]));
  const effectiveVoicesDir = overrideVoicesDir || voicesDir;

  try {
    let result;
    if (useService) {
      const identifyPayload = {
        audio,
        voices_dir: effectiveVoicesDir,
        ...(prevSpeaker ? { prev_speaker: prevSpeaker } : {}),
        ...(Number.isFinite(Number(sameSpeakerThreshold)) ? { same_speaker_threshold: Number(sameSpeakerThreshold) } : {}),
        ...(Number.isFinite(Number(knownSpeakerThreshold)) ? { known_speaker_threshold: Number(knownSpeakerThreshold) } : {}),
        ...(Number.isFinite(Number(mergeGuardThreshold)) ? { merge_guard_threshold: Number(mergeGuardThreshold) } : {}),
        ...(Number.isFinite(Number(clipSeconds)) ? { clip_seconds: Number(clipSeconds) } : {}),
        ...(Number.isFinite(Number(edgeCheckSeconds)) ? { edge_check_seconds: Number(edgeCheckSeconds) } : {}),
        ...(Number.isFinite(Number(edgeMinDurationSeconds)) ? { edge_min_duration_seconds: Number(edgeMinDurationSeconds) } : {}),
        ...(Number.isFinite(Number(edgeMinSimilarity)) ? { edge_min_similarity: Number(edgeMinSimilarity) } : {}),
      };
      result = enrollName
        ? await callService("/enrol", {
          audio,
          name: enrollName,
          voices_dir: effectiveVoicesDir,
          ...(Number.isFinite(Number(clipSeconds)) ? { clip_seconds: Number(clipSeconds) } : {}),
          ...(Number.isFinite(Number(edgeCheckSeconds)) ? { edge_check_seconds: Number(edgeCheckSeconds) } : {}),
          ...(Number.isFinite(Number(edgeMinDurationSeconds)) ? { edge_min_duration_seconds: Number(edgeMinDurationSeconds) } : {}),
          ...(Number.isFinite(Number(edgeMinSimilarity)) ? { edge_min_similarity: Number(edgeMinSimilarity) } : {}),
        })
        : await callService("/identify", identifyPayload);
    } else {
      await ensureSpeakerStarted();
      result = enrollName
        ? await enrolSpeaker({
          audio,
          name: enrollName,
          voicesDir: effectiveVoicesDir,
          clipSeconds,
          edgeCheckSeconds,
          edgeMinDurationSeconds,
          edgeMinSimilarity,
        })
        : await identifySpeaker({
          audio,
          voicesDir: effectiveVoicesDir,
          prevSpeaker,
          sameSpeakerThreshold,
          knownSpeakerThreshold,
          mergeGuardThreshold,
          clipSeconds,
          edgeCheckSeconds,
          edgeMinDurationSeconds,
          edgeMinSimilarity,
        });
    }

    const speaker = String(result?.speaker ?? "").trim();
    if (!speaker) {
      throw new Error("speaker identity defective: empty speaker result");
    }

    return {
      mood: "ya",
      be: "identify",
      from: { name: "speaker identity" },
      ob: { text: speaker },
    };
  } catch (err) {
    throwErrorSentence({
      name: "speaker identity defective",
      message: `speaker identity defective: ${err?.message ?? err}`,
      from: { name: "speaker identity" },
      raw: { sentence },
    });
  }
}

export default speakerIdentity;

export const signatures = [
  { signatureWords: ["be", "speaker", "identity", "as", "wo", "begin"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "as", "wo", "discharge"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "as", "wo", "stop"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "text", "to", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "with", "name", "map"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "with", "name", "map", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "to", "name", "text", "with", "name", "map"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text", "with", "name", "map"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text", "with", "name", "map", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "text", "ob", "text", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "text", "to", "name", "text"], handler: speakerIdentity },
];
