import { remember, doRemember } from "../../remember/index.mjs";
import { appendLog, historyDialogueName, nextAnswerName } from "./history.mjs";
import { getMindLog } from "./session.mjs";

function appendSeriesEntries({ seriesName, callPrompt, responseText }) {
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
  if (responseText !== undefined) {
    entries.push({
      mood: "ya",
      su: { name: "assistant" },
      ob: { text: responseText },
      be: "answer"
    });
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
  return (log || []).map((entry) => ({
    mood: "ya",
    su: { name: entry?.role ?? "assistant" },
    ob: { text: entry?.content ?? "" }
  }));
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

function recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName, historySeriesName }) {
  const { count, name: answerName } = nextAnswerName(mindName, dialogue);
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
  const answerSentence = {
    mood: "ya",
    su: { name: answerName },
    be: "answer",
    from: { name: mindName },
    ob: { text: responseText }
  };
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
  doRemember({
    mood: "ya",
    su: { name: `${mindName} ${dialogue} answer ${count}` },
    be: "answer",
    from: { name: mindName },
    ob: { text: responseText }
  });
  appendLog(dialogue, { role: "assistant", content: responseText });
  if (historySeriesName) {
    appendSeriesEntries({ seriesName: historySeriesName, callPrompt, responseText });
  }
  syncSessionFacts({ dialogue });
  return answerSentence;
}

export {
  appendSeriesEntries,
  seriesNameForDialogue,
  buildSeriesEntriesFromLog,
  syncSessionFacts,
  recordMindAnswer
};
