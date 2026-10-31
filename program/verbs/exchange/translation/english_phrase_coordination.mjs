function tokenSpans(source) {
  return [...source.matchAll(/[A-Za-z]+(?:\(s\))?(?:'[A-Za-z]+)?(?:-[A-Za-z]+(?:'[A-Za-z]+)?)*/gu)].map((match) => ({
    surface: match[0].toLowerCase().replace(/\(s\)$/iu, "s"),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
}

function trimBounds(source, startOffset, endOffset) {
  const value = source.slice(startOffset, endOffset);
  const leading = value.search(/\S/u);
  if (leading < 0) return null;
  const trailing = value.search(/\s+$/u);
  const endTrim = trailing < 0 ? value.length : trailing;
  return {
    text: value.slice(leading, endTrim),
    startOffset: startOffset + leading,
    endOffset: startOffset + endTrim
  };
}

function connectorAt(records, index) {
  const record = records[index];
  return record?.grammar?.kind === "conjunction"
    ? { surface: record.surface, pyashSequence: [...(record.pyashSequence ?? [])] }
    : null;
}

function phraseItem(source, spans, records, bounds, separator, connector = null) {
  const indexes = spans.flatMap((span, index) => (
    span.start >= bounds.startOffset && span.end <= bounds.endOffset ? [index] : []
  ));
  let start = indexes[0] ?? 0;
  const end = (indexes.at(-1) ?? start - 1) + 1;
  if (connector && records[start]?.grammar?.kind === "conjunction") start += 1;
  const itemSpans = spans.slice(start, end);
  const itemStartOffset = itemSpans[0]?.start ?? bounds.startOffset;
  const itemBounds = itemSpans.length > 0
    ? trimBounds(source, itemStartOffset, bounds.endOffset)
    : bounds;
  const itemRecords = records.slice(start, end);
  const internalConnectors = itemRecords.flatMap((record, index) => (
    record.grammar?.kind === "conjunction"
      ? [{
        surface: record.surface,
        pyashSequence: [...(record.pyashSequence ?? [])],
        tokenIndex: start + index
      }]
      : []
  ));
  return {
    surface: itemBounds?.text ?? bounds.text,
    start,
    end,
    startOffset: itemBounds?.startOffset ?? bounds.startOffset,
    endOffset: itemBounds?.endOffset ?? bounds.endOffset,
    separator,
    ...(connector ? { connector } : {}),
    pyashSequence: itemRecords
      .filter((record) => !record.consumedBy)
      .flatMap((record) => [...(record.pyashSequence ?? []), ...(record.morphology?.markerSequence ?? [])]),
    internalConnectors
  };
}

function splitByTopLevelCommas(source, startOffset, endOffset) {
  const result = [];
  let cursor = startOffset;
  let nesting = 0;
  for (let offset = startOffset; offset < endOffset; offset += 1) {
    if (source[offset] === "(") nesting += 1;
    else if (source[offset] === ")") nesting = Math.max(0, nesting - 1);
    else if (source[offset] === "," && nesting === 0) {
      const bounds = trimBounds(source, cursor, offset);
      if (bounds) result.push(bounds);
      cursor = offset + 1;
    }
  }
  const tail = trimBounds(source, cursor, endOffset);
  if (tail) result.push(tail);
  return result;
}

function splitFinalConjunction(source, spans, records, bounds) {
  const indexes = spans.flatMap((span, index) => (
    span.start >= bounds.startOffset && span.end <= bounds.endOffset ? [index] : []
  ));
  const candidates = indexes.filter((index) => records[index]?.grammar?.kind === "conjunction");
  const index = candidates.at(-1);
  if (index === undefined) return null;
  const leftEnd = spans[index]?.start ?? bounds.startOffset;
  const rightStart = spans[index]?.end ?? bounds.endOffset;
  const left = trimBounds(source, bounds.startOffset, leftEnd);
  const right = trimBounds(source, rightStart, bounds.endOffset);
  if (!left || !right) return null;
  return [
    { bounds: left, connector: null },
    { bounds: right, connector: connectorAt(records, index) }
  ];
}

export function segmentEnglishPhraseList({
  source,
  records,
  startIndex,
  endIndex,
  scope = "phrase",
  role = ""
} = {}) {
  if (typeof source !== "string" || !Array.isArray(records)) return null;
  const spans = tokenSpans(source);
  if (startIndex >= endIndex || !spans[startIndex] || !spans[endIndex - 1]) return null;
  const startOffset = spans[startIndex].start;
  const endOffset = spans[endIndex - 1].end;
  const commaSegments = splitByTopLevelCommas(source, startOffset, endOffset);
  let segments = commaSegments.map((bounds, index) => ({ bounds, separator: index ? "comma" : null }));

  if (segments.length === 1) {
    const split = splitFinalConjunction(source, spans, records, segments[0].bounds);
    if (split) segments = split.map((segment, index) => ({ ...segment, separator: index ? "conjunction" : null }));
  } else if (segments.length > 1) {
    const last = segments.at(-1);
    const firstLastToken = spans.findIndex((span) => (
      span.start >= last.bounds.startOffset && span.end <= last.bounds.endOffset
    ));
    const startsWithConnector = firstLastToken >= 0
      && records[firstLastToken]?.grammar?.kind === "conjunction";
    const split = startsWithConnector
      ? null
      : splitFinalConjunction(source, spans, records, last.bounds);
    if (split) {
      segments = [
        ...segments.slice(0, -1),
        { ...split[0], separator: last.separator },
        { ...split[1], separator: "conjunction" }
      ];
    }
  }

  if (segments.length < 2) return null;
  const items = segments.map(({ bounds, separator, connector }, index) => {
    const first = spans.findIndex((span) => span.start >= bounds.startOffset && span.end <= bounds.endOffset);
    const leadingConnector = first >= 0 ? connectorAt(records, first) : null;
    const actualConnector = connector ?? leadingConnector;
    return phraseItem(source, spans, records, bounds, separator ?? (index ? "comma" : null), actualConnector);
  });
  return {
    kind: "phrase-list",
    scope,
    role,
    items,
    evidence: "top-level commas and conjunctions delimit phrase items; parenthetical and item-internal conjunctions remain within their phrase"
  };
}

function recordHead(record) {
  if (!record || record.consumedBy || record.grammar || record.copula) return null;
  const sequence = [...(record.pyashSequence ?? [])];
  if (sequence.length === 0) return null;
  return {
    surface: record.surface,
    lemma: String(record.sourceLemma ?? record.surface ?? "").toLowerCase(),
    pyashSequence: sequence
  };
}

function firstLexicalHead(item, records) {
  for (let index = item.start; index < item.end; index += 1) {
    const head = recordHead(records[index]);
    if (head) return { index, head };
  }
  return null;
}

function beginsWithLinkedCase(item, records) {
  for (let index = item.start; index < item.end; index += 1) {
    const record = records[index];
    if (record?.consumedBy) continue;
    return record?.grammar?.kind === "case-marker" && record.grammar.position === "link";
  }
  return false;
}

export function findSharedPhraseHead(coordination, records) {
  if (coordination?.kind !== "phrase-list" || !Array.isArray(coordination.items)) return null;
  const headed = coordination.items.map((item, itemIndex) => ({
    itemIndex,
    first: firstLexicalHead(item, records),
    item
  }));
  const groups = new Map();
  for (const entry of headed) {
    if (!entry.first) continue;
    const key = `${entry.first.head.lemma}\u0000${entry.first.head.pyashSequence.join(" ")}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const candidate = [...groups.values()]
    .filter((group) => group.length >= 2)
    .sort((left, right) => right.length - left.length)[0];
  if (!candidate) return null;
  const shared = candidate[0].first.head;
  const matchingIndexes = new Set(candidate.map((entry) => entry.itemIndex));
  const reflexiveIndexes = [];
  for (const { itemIndex, item } of headed) {
    if (matchingIndexes.has(itemIndex)) continue;
    if (item.surface.toLowerCase().startsWith(`self-${shared.lemma}`)) reflexiveIndexes.push(itemIndex);
  }
  const omittedIndexes = coordination.items.flatMap((item, itemIndex) => (
    !matchingIndexes.has(itemIndex)
      && !reflexiveIndexes.includes(itemIndex)
      && beginsWithLinkedCase(item, records)
      ? [itemIndex]
      : []
  ));
  const accounted = matchingIndexes.size + reflexiveIndexes.length + omittedIndexes.length;
  if (omittedIndexes.length === 0 || accounted !== coordination.items.length) return null;
  return {
    kind: "shared-head",
    head: shared,
    explicitItemIndexes: [...matchingIndexes],
    itemHeadIndexes: Object.fromEntries(candidate.map((entry) => [
      entry.itemIndex,
      entry.first.index
    ])),
    reflexiveItemIndexes: reflexiveIndexes,
    inheritedItemIndexes: omittedIndexes,
    placement: "after-list",
    evidence: "the same lexical head is repeated in list members and omitted members begin with a case phrase"
  };
}

