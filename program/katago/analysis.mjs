function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function stripFence(text = "") {
  const raw = String(text ?? "");
  const match = raw.match(/```(?:sgf|go|katago)?\s*([\s\S]*?)```/iu);
  return match ? match[1].trim() : raw.trim();
}

export function extractSgfText(input = {}) {
  if (typeof input === "string") return stripFence(input);
  const explicit = normalizeText(input?.sgf ?? input?.text ?? input?.prompt);
  if (explicit) return stripFence(explicit);
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || String(message.role ?? "user").toLowerCase() === "assistant") continue;
    const content = message.content;
    if (typeof content === "string" && content.trim()) return stripFence(content);
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => normalizeText(part?.text ?? part?.content ?? ""))
        .filter(Boolean);
      if (parts.length) return stripFence(parts.join("\n"));
    }
  }
  return "";
}

export function parseSgfMoves(sgfText = "") {
  const sgf = stripFence(sgfText);
  if (!sgf.includes("(;")) {
    throw new Error("katago requires SGF text beginning with (; or a fenced SGF block");
  }
  const moves = [];
  const regex = /;([BW])\[([^\]]*)\]/giu;
  for (const match of sgf.matchAll(regex)) {
    moves.push([String(match[1]).toUpperCase(), String(match[2] ?? "")]);
  }
  return moves;
}

export function buildKataGoQuery({
  sgf = "",
  id = "pyash-katago",
  maxVisits = 100,
  boardXSize: rawBoardXSize,
  boardYSize: rawBoardYSize,
  rules,
  komi: rawKomi
} = {}) {
  const moves = parseSgfMoves(sgf);
  const initialStones = [];
  const boardXSize = Number.isFinite(Number(rawBoardXSize)) ? Number(rawBoardXSize) : 19;
  const boardYSize = Number.isFinite(Number(rawBoardYSize)) ? Number(rawBoardYSize) : boardXSize;
  return {
    id: normalizeText(id) || "pyash-katago",
    moves,
    initialStones,
    rules: normalizeText(rules) || "tromp-taylor",
    komi: Number.isFinite(Number(rawKomi)) ? Number(rawKomi) : 7.5,
    boardXSize,
    boardYSize,
    analyzeTurns: [moves.length],
    maxVisits: Math.max(1, Math.trunc(Number(maxVisits) || 100))
  };
}

function percent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return `${(num * 100).toFixed(1)}%`;
}

function fixed(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(digits);
}

export function normalizeKataGoResult(raw = {}) {
  const moveInfos = Array.isArray(raw?.moveInfos) ? raw.moveInfos : [];
  const best = moveInfos[0] ?? {};
  const candidates = moveInfos.slice(0, 8).map((item) => ({
    move: normalizeText(item?.move),
    visits: Number(item?.visits ?? 0),
    winrate: Number(item?.winrate ?? 0),
    scoreLead: Number(item?.scoreLead ?? 0),
    prior: Number(item?.prior ?? 0),
    order: Number(item?.order ?? 0),
    pv: Array.isArray(item?.pv) ? item.pv.map((value) => String(value ?? "")) : []
  }));
  return {
    id: normalizeText(raw?.id),
    turnNumber: Number(raw?.turnNumber ?? 0),
    rootInfo: raw?.rootInfo && typeof raw.rootInfo === "object" ? raw.rootInfo : {},
    bestMove: normalizeText(best?.move),
    winrate: Number(best?.winrate ?? raw?.rootInfo?.winrate ?? 0),
    scoreLead: Number(best?.scoreLead ?? raw?.rootInfo?.scoreLead ?? 0),
    visits: Number(best?.visits ?? raw?.rootInfo?.visits ?? 0),
    candidates,
    raw
  };
}

export function summarizeKataGoResult(raw = {}) {
  const normalized = normalizeKataGoResult(raw);
  if (!normalized.bestMove) return "KataGo analysis completed.";
  const parts = [`KataGo likes ${normalized.bestMove}`];
  const winrateText = percent(normalized.winrate);
  if (winrateText) parts.push(`winrate ${winrateText}`);
  const scoreLeadText = fixed(normalized.scoreLead, 1);
  if (scoreLeadText) parts.push(`score lead ${scoreLeadText}`);
  if (normalized.visits) parts.push(`${normalized.visits} visits`);
  const top = normalized.candidates
    .slice(0, 3)
    .map((item) => item.move)
    .filter(Boolean);
  if (top.length > 1) parts.push(`top candidates ${top.join(", ")}`);
  return `${parts.join("; ")}.`;
}

export function buildKataGoJobSpec(input = {}) {
  const sgf = extractSgfText(input);
  if (!sgf) throw new Error("katago requires SGF text");
  const query = input?.query && typeof input.query === "object"
    ? input.query
    : buildKataGoQuery({
      sgf,
      id: input?.id ?? "pyash-katago",
      maxVisits: input?.maxVisits ?? input?.visits,
      boardXSize: input?.boardXSize,
      boardYSize: input?.boardYSize,
      rules: input?.rules,
      komi: input?.komi
    });
  return {
    kind: "katago-analyze",
    sgf,
    query,
    timeoutSec: Number.isFinite(Number(input?.timeoutSec)) ? Math.max(1, Math.trunc(Number(input.timeoutSec))) : 120
  };
}

