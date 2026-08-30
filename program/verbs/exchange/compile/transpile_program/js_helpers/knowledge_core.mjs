export function knowledgeCoreHelperSource() {
  return `const __pyaKnowledgeRecords = [];
function __pyaKnowledgeNp(value) {
  if (!value || typeof value !== "object") return "";
  if (value.la) return "la " + __pyaKnowledgeSentence(value.la) + " ko";
  if (value.name !== undefined) return "name " + (Array.isArray(value.nameTypeWords) && value.nameTypeWords.length ? value.nameTypeWords.join(" ") + " " : "") + value.name;
  if (value.text !== undefined) return "text " + JSON.stringify(String(value.text));
  if (value.wo !== undefined) return "wo " + String(value.wo);
  if (value.date !== undefined) return "date " + String(value.date);
  if (value.num !== undefined) return "num " + String(value.num);
  if (value.boolean !== undefined) return "bool " + (value.boolean ? "truth" : "lie");
  if (value.hollow) return "hollow";
  return "";
}
function __pyaKnowledgeSentence(sentence) {
  const parts = [];
  if (sentence?.exists) parts.push("exists");
  for (const key of ["su", "ob", "vyah", "fromindex", "atindex", "toindex", "from", "at", "to", "outof", "in", "into", "offof", "on", "onto", "fromunder", "under", "beneath", "since", "during", "until", "fromstate", "as", "become", "fromgroup", "among", "intogroup", "fromtext", "accordingto", "totext", "times", "by"]) {
    if (sentence?.[key] === undefined) continue;
    if (key === "vyah") {
      const values = Array.isArray(sentence.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
      parts.push("vyah", ...values);
    } else {
      parts.push(key, __pyaKnowledgeNp(sentence[key]));
    }
  }
  if (sentence?.be !== undefined) parts.push("be", String(sentence.be));
  if (sentence?.mood !== undefined) parts.push(String(sentence.mood));
  return parts.join(" ");
}
function __pyaKnowledgeClaimKey(sentence) {
  const parts = ["su", __pyaKnowledgeNp(sentence?.su)];
  if (sentence?.since && sentence?.until) parts.push("since", __pyaKnowledgeNp(sentence.since), "until", __pyaKnowledgeNp(sentence.until));
  if (sentence?.as !== undefined) parts.push("as", __pyaKnowledgeNp(sentence.as));
  parts.push("be", String(sentence?.be ?? ""), "ya");
  return parts.join(" ");
}
function __pyaKnowledgeJson(value) {
  if (Array.isArray(value)) return value.map(__pyaKnowledgeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, __pyaKnowledgeJson(entry)]));
}
function __pyaKnowledgePayloadKey(value) {
  return JSON.stringify(__pyaKnowledgeJson(value));
}
function __pyaKnowledgeAnchor(sentence) {
  const embedded = sentence?.fromtext?.la;
  if (embedded) {
    const source = embedded?.su?.name ?? embedded?.source?.name ?? embedded?.source?.text ?? "";
    const anchor = embedded?.ob?.text ?? embedded?.ob?.name ?? embedded?.ob?.wo ?? embedded?.anchor?.text ?? "";
    if (source || anchor) return { source: String(source), anchor: String(anchor), anchorId: String(source) + "#" + String(anchor) };
  }
  const raw = sentence?.fromtext?.text ?? sentence?.fromtext?.name ?? sentence?.fromtext?.wo ?? "";
  const parts = String(raw).includes("#") ? String(raw).split("#") : String(raw).trim().split(/\\s+/u);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { source: null, anchor: null, anchorId: null };
  return { source: parts[0], anchor: parts[1], anchorId: parts[0] + "#" + parts[1] };
}
function __pyaKnowledgeRecord(sentence) {
  const anchor = __pyaKnowledgeAnchor(sentence);
  return {
    key: __pyaKnowledgeClaimKey(sentence),
    payload: sentence?.ob ?? { hollow: true },
    evidential: String(sentence?.accordingto?.name ?? "").replace(/-evidential$/u, ""),
    confidence: sentence?.by?.num ?? null,
    source: anchor.source,
    anchor: anchor.anchor,
    anchorId: anchor.anchorId,
    sentence: __pyaKnowledgeSentence(sentence)
  };
}
function __pyaKnowledgeAdd(sentence) {
  const evidential = String(sentence?.accordingto?.name ?? "").toLowerCase();
  if (!/^(direct|reported|inferential)-evidential$/u.test(evidential)) throw new Error("evidential defective");
  if (sentence?.by?.num === undefined || !Number.isFinite(Number(sentence.by.num)) || Number(sentence.by.num) < 0 || Number(sentence.by.num) > 1) throw new Error("confidence defective");
  const anchor = __pyaKnowledgeAnchor(sentence);
  if (!anchor.anchorId || !/^[A-Za-z0-9][A-Za-z0-9._:-]*#[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(anchor.anchorId)) throw new Error("source anchor defective");
  __pyaKnowledgeRecords.push(sentence);
  return sentence;
}
function __pyaKnowledgeEvidence(records, key) {
  return records.filter(sentence => __pyaKnowledgeClaimKey(sentence) === key).map(__pyaKnowledgeRecord);
}
function __pyaKnowledgeCompare(left, right) {
  const leftAnchor = String(left.anchorId ?? "");
  const rightAnchor = String(right.anchorId ?? "");
  if (leftAnchor < rightAnchor) return -1;
  if (leftAnchor > rightAnchor) return 1;
  const leftConfidence = left.confidence ?? -1;
  const rightConfidence = right.confidence ?? -1;
  if (leftConfidence !== rightConfidence) return rightConfidence - leftConfidence;
  return String(left.sentence) < String(right.sentence) ? -1 : (String(left.sentence) > String(right.sentence) ? 1 : 0);
}
function __pyaKnowledgeCompareDuplicate(left, right) {
  const leftConfidence = left.confidence ?? -1;
  const rightConfidence = right.confidence ?? -1;
  if (leftConfidence !== rightConfidence) return rightConfidence - leftConfidence;
  return __pyaKnowledgeCompare(left, right);
}
function __pyaKnowledgeSelected(records) {
  const selected = new Map();
  for (const record of records) {
    const payloadKey = __pyaKnowledgePayloadKey(record.payload);
    const prior = selected.get(payloadKey);
    if (!prior || __pyaKnowledgeCompareDuplicate(record, prior) < 0) selected.set(payloadKey, record);
  }
  return [...selected.values()].sort((left, right) => __pyaKnowledgePayloadKey(left.payload).localeCompare(__pyaKnowledgePayloadKey(right.payload)));
}
function __pyaKnowledgeCurrent(key) {
  const selected = __pyaKnowledgeSelected(__pyaKnowledgeEvidence(__pyaKnowledgeRecords, key));
  const contested = selected.length > 1;
  return { view: "current", key, status: selected.length === 0 ? "unrelated" : (contested ? "contested" : "current"), record: contested ? null : (selected[0] ?? null), records: selected };
}
function __pyaKnowledgeContested(key) {
  const selected = __pyaKnowledgeSelected(__pyaKnowledgeEvidence(__pyaKnowledgeRecords, key));
  return { view: "contested", key, status: "contested", records: selected, conflict: selected.length > 1 };
}
function __pyaKnowledgeProvenance(key) {
  const records = __pyaKnowledgeEvidence(__pyaKnowledgeRecords, key).sort(__pyaKnowledgeCompare);
  return { view: "provenance", key, status: "provenance", records };
}
function __pyaKnowledgeClaimChoose(key) {
  return JSON.stringify(__pyaKnowledgeCurrent(key));
}
globalThis.__pyaKnowledgeRecords = __pyaKnowledgeRecords;
globalThis.__pyaKnowledge = {
  records: __pyaKnowledgeRecords,
  claimKey: __pyaKnowledgeClaimKey,
  claimIdentify: __pyaKnowledgeClaimKey,
  claimChoose: __pyaKnowledgeClaimChoose,
  resolveCurrent: __pyaKnowledgeCurrent,
  resolveContested: __pyaKnowledgeContested,
  resolveProvenance: __pyaKnowledgeProvenance
};`;
}
