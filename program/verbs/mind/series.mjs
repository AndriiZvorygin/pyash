import { remember, doRemember } from "../../remember/index.mjs";
import { appendLog, historyDialogueName, nextAnswerName } from "./history.mjs";
import { getMindLog } from "./session.mjs";
import { normalizeMindReply, rememberReplyMetadata, replyMetadataName, replySentence } from "./reply.mjs";

function appendSeriesEntries({ seriesName, callPrompt, envelope, responseText, metadataName }) {
  if (!seriesName) return;
  const fact = remember(seriesName);
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return;
  const entries = [...fact.ob.series];
  if (callPrompt) {
    entries.push({
      mood: "ya",
      su: { name: "user" },
      ob: { text: callPrompt },
      be: "write"
    });
  }
  if (envelope || responseText !== undefined) {
    entries.push(replySentence({
      envelope: envelope ?? normalizeMindReply({ response: responseText }),
      answerName: "assistant",
      metadataName,
      role: "assistant",
      be: "answer"
    }));
  }
  doRemember({
    ...fact,
    ob: { series: entries }
  });
}

function seriesNameForDialogue(dialogue) {
  if (!dialogue) return null;
  return `${dialogue} session`;
}

function buildSeriesEntriesFromLog(log) {
  return (log || []).map((entry) => {
    if (entry?.role === "user") {
      return {
        mood: "ya",
        su: { name: "user" },
        ob: { text: String(entry?.content ?? "") },
        be: "write"
      };
    }
    return replySentence({
      envelope: normalizeMindReply({
        response: entry?.content ?? "",
        ...(entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {}),
        ...(entry?.thinking !== undefined ? { thinking: entry.thinking } : {}),
        ...(entry?.createdAt !== undefined ? { created_at: entry.createdAt } : {}),
        ...(entry?.model !== undefined ? { model: entry.model } : {}),
        ...(entry?.role !== undefined ? { role: entry.role } : {})
      }),
      answerName: entry?.role ?? "assistant",
      metadataName: entry?.metadataName,
      role: entry?.role ?? "assistant",
      be: "answer"
    });
  });
}

function syncSessionFacts({ dialogue }) {
  if (!dialogue) return;
  const log = getMindLog(dialogue);
  const seriesName = seriesNameForDialogue(dialogue);
  if (!seriesName) return;
  const seriesEntries = buildSeriesEntriesFromLog(log);
  doRemember({
    mood: "ya",
    su: { name: seriesName },
    be: "series",
    ob: { series: seriesEntries }
  });
  const mapFact = remember("mind session map");
  const map = (mapFact?.ob?.map && typeof mapFact.ob.map === "object")
    ? { ...mapFact.ob.map }
    : {};
  map[dialogue] = {
    mood: "ya",
    su: { name: dialogue },
    be: "series",
    ob: { name: seriesName }
  };
  doRemember({
    mood: "ya",
    su: { name: "mind session map" },
    be: "map",
    ob: { map }
  });
}

function recordMindAnswer({ mindName, dialogue, callPrompt, responseText, envelope, outputName, historySeriesName }) {
  const reply = envelope ?? normalizeMindReply({ response: responseText });
  const { count, name: answerName } = nextAnswerName(mindName, dialogue);
  const metadataName = Object.keys(reply.metadata ?? {}).length > 0
    ? rememberReplyMetadata(replyMetadataName(answerName), reply.metadata)
    : null;
  if (callPrompt) {
    doRemember({
      mood: "ya",
      su: { name: `${mindName} ${dialogue} question ${count}` },
      be: "write",
      from: { name: "user" },
      ob: { text: callPrompt }
    });
    appendLog(dialogue, { role: "user", content: callPrompt });
  }
  const answerSentence = replySentence({
    envelope: reply,
    subjectName: answerName,
    answerName,
    fromName: mindName,
    metadataName
  });
  doRemember(answerSentence);
  doRemember({
    ...answerSentence,
    su: { name: "result" }
  });
  if (outputName) {
    doRemember({
      ...answerSentence,
      su: { name: outputName }
    });
  }
  doRemember(replySentence({
    envelope: reply,
    answerName: `${mindName} ${dialogue} answer ${count}`,
    fromName: mindName,
    metadataName
  }));
  appendLog(dialogue, {
    role: "assistant",
    content: reply.text,
    metadata: reply.metadata,
    metadataName,
    thinking: reply.thinking,
    createdAt: reply.createdAt,
    model: reply.model
  });
  if (historySeriesName) {
    appendSeriesEntries({ seriesName: historySeriesName, callPrompt, envelope: reply, metadataName });
  }
  syncSessionFacts({ dialogue });
  return { ...answerSentence, envelope: reply, metadataName };
}

export {
  appendSeriesEntries,
  seriesNameForDialogue,
  buildSeriesEntriesFromLog,
  syncSessionFacts,
  recordMindAnswer
};
