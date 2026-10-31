import { isMarkdownDivider, splitTextSentences, hasSpeakableContent, sectionWordTokens } from "./cuts.mjs";

export function normalizeCutEntry(entry, index) {
  const since = Number(entry?.since?.num ?? entry?.since ?? 0);
  const until = Number(entry?.until?.num ?? entry?.until ?? since);
  const obText = String(entry?.ob?.text ?? entry?.obText ?? "");
  const obFilename = String(entry?.ob?.filename ?? entry?.obFilename ?? "");
  const sourceText = String(entry?.fromtext?.text ?? entry?.sourceText ?? entry?.fromtextText ?? "");
  const workflowName = String(entry?.as?.text ?? entry?.workflowName ?? entry?.asText ?? "");
  const name = String(entry?.su?.name ?? entry?.name ?? `cut ${String(index).padStart(3, "0")}`);
  return {
    index,
    name,
    since: Number.isFinite(since) ? since : 0,
    until: Number.isFinite(until) ? until : 0,
    obText,
    obFilename,
    sourceText,
    workflowName
  };
}

export function itineraryCutsFromSeriesFact(fact = {}) {
  const entries = Array.isArray(fact?.ob?.series) ? fact.ob.series : [];
  return entries
    .map((entry, idx) => normalizeCutEntry(entry, idx + 1))
    .filter(cut => cut.obText || cut.obFilename);
}

export function windowCuts(rows = [], targetSeconds = 6) {
  const target = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : 6;
  const ordered = Array.isArray(rows) ? rows : [];
  if (!ordered.length) return [];
  const out = [];
  let cursor = null;
  let index = 1;
  const flush = () => {
    if (!cursor) return;
    const text = cursor.textParts.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push({
      index,
      name: `cut ${String(index).padStart(3, "0")}`,
      since: cursor.since,
      until: Math.max(cursor.until, cursor.since + 0.05),
      obText: text
    });
    index += 1;
    cursor = null;
  };
  for (const row of ordered) {
    const since = Number(row?.since ?? 0);
    const until = Number(row?.until ?? since);
    const text = String(row?.obText ?? "").trim();
    if (!text) continue;
    if (!cursor) {
      cursor = { since, until, textParts: [text] };
      continue;
    }
    const nextUntil = Math.max(cursor.until, until);
    const spanIfMerged = nextUntil - cursor.since;
    if (spanIfMerged <= target || cursor.textParts.length < 2) {
      cursor.until = nextUntil;
      cursor.textParts.push(text);
      continue;
    }
    flush();
    cursor = { since, until, textParts: [text] };
  }
  flush();
  return out;
}

export function splitOversizedCut(cut = {}, targetSeconds = 6) {
  const target = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : 6;
  const since = Number(cut?.since ?? 0);
  const until = Number(cut?.until ?? since);
  const span = until - since;
  const text = String(cut?.obText ?? "").replace(/\s+/g, " ").trim();
  if (!(Number.isFinite(span) && span > target + 1e-6) || !text) return [cut];

  const sentenceSections = splitTextSentences(text).filter(Boolean)
    .filter((entry) => !isMarkdownDivider(entry))
    .filter((entry) => hasSpeakableContent(entry));
  if (sentenceSections.length < 2 && sectionWordTokens(text).length < 8) return [cut];
  const sections = sentenceSections.length > 1 ? sentenceSections : text.split(/\s+/u).filter(Boolean);
  if (sections.length < 2) return [cut];

  const partCount = Math.min(sections.length, Math.max(2, Math.ceil(span / target)));
  if (partCount < 2) return [cut];

  const grouped = Array.from({ length: partCount }, () => []);
  for (let i = 0; i < sections.length; i += 1) {
    const bucket = Math.min(partCount - 1, Math.floor(i * partCount / sections.length));
    grouped[bucket].push(sections[i]);
  }
  const chunks = grouped
    .map((parts) => parts.join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (chunks.length < 2) return [cut];

  const totalWords = chunks.reduce((sum, chunk) => sum + sectionWordTokens(chunk).length, 0);
  if (totalWords <= 0) return [cut];

  const out = [];
  let cursor = since;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const words = Math.max(1, sectionWordTokens(chunk).length);
    const remaining = until - cursor;
    const duration = i === chunks.length - 1
      ? remaining
      : Math.max(0.05, span * (words / totalWords));
    const nextUntil = i === chunks.length - 1 ? until : Math.min(until, cursor + duration);
    out.push({
      ...cut,
      since: cursor,
      until: nextUntil,
      obText: chunk
    });
    cursor = nextUntil;
  }
  if (out.length) {
    out[out.length - 1].until = until;
  }
  return out;
}

