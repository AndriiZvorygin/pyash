import { throwErrorSentence } from "../error.mjs";
import {
  ensureStarted as ensureSpeakerStarted,
  identify as identifySpeaker,
  enrol as enrolSpeaker,
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
  return trimmed || "";
}

function resolveAudioFilename(sentence) {
  const value = sentence?.from?.filename;
  if (typeof value !== "string") return "";
  return value.trim();
}

function resolveEnrollName(sentence) {
  const text = sentence?.ob?.text;
  if (typeof text !== "string") return "";
  return text.trim();
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

  try {
    let result;
    if (useService) {
      result = enrollName
        ? await callService("/enrol", { audio, name: enrollName, voices_dir: voicesDir })
        : await callService("/identify", { audio, voices_dir: voicesDir });
    } else {
      await ensureSpeakerStarted();
      result = enrollName
        ? await enrolSpeaker({ audio, name: enrollName, voicesDir })
        : await identifySpeaker({ audio, voicesDir });
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
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "wo", "audio", "ob", "text", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "text", "ob", "text", "to", "name", "text"], handler: speakerIdentity },
  { signatureWords: ["be", "speaker", "identity", "from", "filename", "fromstate", "text", "to", "name", "text"], handler: speakerIdentity },
];
