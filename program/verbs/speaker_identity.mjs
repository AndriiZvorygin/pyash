import { throwErrorSentence } from "../error.mjs";
import {
  ensureStarted as ensureSpeakerStarted,
  identify as identifySpeaker,
  enrol as enrolSpeaker,
  discharge as dischargeSpeaker,
  stop as stopSpeaker,
} from "../../command/speaker_runner.mjs";

function resolveAction(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.text ?? sentence?.as?.name ?? "";
  return String(raw ?? "").trim().toLowerCase();
}

function resolveVoicesDir(sentence) {
  const text = sentence?.fromstate?.text;
  if (typeof text !== "string") return "./world/voices";
  const trimmed = text.trim();
  return trimmed || "./world/voices";
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

export async function speakerIdentity(sentence) {
  const action = resolveAction(sentence);
  if (action === "begin") {
    await ensureSpeakerStarted();
    return { mood: "ya", be: "begin", as: { wo: "speaker identity" }, ob: { boolean: true } };
  }
  if (action === "discharge") {
    const result = await dischargeSpeaker();
    return { mood: "ya", be: "discharge", as: { wo: "speaker identity" }, ob: { boolean: Boolean(result?.alive ?? true) } };
  }
  if (action === "stop") {
    await stopSpeaker();
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

  const voicesDir = resolveVoicesDir(sentence);
  const enrollName = resolveEnrollName(sentence);

  try {
    await ensureSpeakerStarted();
    const result = enrollName
      ? await enrolSpeaker({ audio, name: enrollName, voicesDir })
      : await identifySpeaker({ audio, voicesDir });

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
